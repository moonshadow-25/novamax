import path from 'path';
import fs from 'fs';
import { genId } from '../../utils/idGen.js';
import { normalizeEngineType } from '../../utils/engineTypeHelper.js';
import { sendToEngine } from '../engine/lifecycle.js';
import { segmentText } from './segmenter.js';
import { ffmpegConcat, ffmpegConvert } from '../audio/ffmpeg.js';

const MAX_TEXT_LENGTH_FALLBACK = 4000;

export async function synthesize({
  text, voiceRef, engineType, outputFormat, outputDir, params, workspaceId,
  sourceFile, sourceType, modelDir, llmPort, log,
  engines, historyRepo, ffmpegDir, defaultOutputDir,
}) {
  const engineEntry = engines.get(normalizeEngineType(engineType));
  engineEntry.lastActiveTime = Date.now();
  log.info(`Synthesis start: ${text.length} chars, voice=${voiceRef.id || '-'}, engine=${engineType}`);

  const resolvedDir = outputDir || defaultOutputDir;
  fs.mkdirSync(resolvedDir, { recursive: true });

  // no_concat 参数：跳过文本分段，整段直接给引擎
  const noSegment = params?.no_concat;
  const maxLen = engineEntry?.report?.runtimeConfig?.max_text_length
    || engineEntry?.contract?.capabilities?.max_text_length
    || MAX_TEXT_LENGTH_FALLBACK;
  const segs = noSegment ? [text] : await segmentText(text, maxLen, llmPort || 0);
  if (segs.length > 1) log.info(`Text segmented: ${segs.length} parts (max=${maxLen}/segment)`);

  const results = await enqueueEngineTask(engineEntry, async () => {
    const res = [];
    for (let i = 0; i < segs.length; i++) {
      const r = await sendToEngine(engineEntry, 'synthesize', {
        text: segs[i],
        voice: voiceRef,
        output_format: outputFormat,
        output_dir: resolvedDir,
        workspace_id: workspaceId || '',
        request_id: genId('req'),
        params: { ...params, index: i }
      });
      res.push(r);
      try { await sendToEngine(engineEntry, 'clearCache', {}); } catch {}
    }
    return res;
  });

  if (results.length > 1) log.info(`${results.length} segments done, concatenating...`);

  let audio, actualFormat = outputFormat;

  if (results.length === 1) {
    audio = Buffer.from(results[0].audio);
  } else {
    audio = await ffmpegConcat(results, outputFormat, resolvedDir, ffmpegDir);
  }

  if (outputFormat !== 'wav') {
    const tmpWavPath = path.join(resolvedDir, `${genId('tmpwav')}.wav`);
    fs.writeFileSync(tmpWavPath, audio);
    try {
      audio = await ffmpegConvert(tmpWavPath, outputFormat, ffmpegDir);
    } finally {
      try { fs.unlinkSync(tmpWavPath); } catch {} }
  }

  const totalDuration = results.reduce((s, r) => s + (r?.duration_seconds || 0), 0);
  const avgRtf = results.length > 0 ? results.reduce((s, r) => s + (r?.rtf || 0), 0) / results.length : 0;

  log.info(`Synthesis complete: ${totalDuration.toFixed(1)}s, RTF=${avgRtf.toFixed(2)}, segments=${segs.length}`);

  fs.mkdirSync(resolvedDir, { recursive: true });
  const outFile = path.join(resolvedDir, buildOutputFilename(voiceRef, text, outputFormat));
  fs.writeFileSync(outFile, audio);

  for (const r of results) {
    if (r.output_path && r.output_path !== outFile) {
      try { fs.unlinkSync(r.output_path); } catch {}
    }
  }

  const historyId = historyRepo.createHistory({
    workspaceId, voiceId: voiceRef.id || null, text, outputFile: outFile,
    outputFormat, duration: totalDuration, rtf: avgRtf,
    engineType, params, sourceFile, sourceType
  });

  return { historyId, audio, duration: totalDuration, output_file: outFile, segment_count: segs.length };
}

function enqueueEngineTask(entry, taskFn) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      try {
        entry._busy = true;
        entry.activeTasks++;
        resolve(await taskFn());
      } catch (e) {
        reject(e);
      } finally {
        entry._busy = false;
        entry.activeTasks = Math.max(0, entry.activeTasks - 1);
        const next = entry._taskQueue?.shift();
        if (next) next();
      }
    };

    if (!entry._busy) {
      run();
    } else {
      if (!entry._taskQueue) entry._taskQueue = [];
      entry._taskQueue.push(run);
    }
  });
}

function buildOutputFilename(voiceRef, text, format) {
  const clean = (text || '').replace(/[\s\n\r]+/g, '').slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${voiceRef.id || 'synth'}_${clean}_${rand}.${format}`;
}
