import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

function getFfmpegExe(ffmpegDir) {
  if (!ffmpegDir || !fs.existsSync(ffmpegDir)) return null;
  let dirs;
  try { dirs = fs.readdirSync(ffmpegDir, { withFileTypes: true }).filter(d => d.isDirectory()); } catch { return null; }
  for (const d of dirs) {
    const exe = path.join(ffmpegDir, d.name, 'ffmpeg.exe');
    if (fs.existsSync(path.join(ffmpegDir, d.name, '.installed')) && fs.existsSync(exe)) return exe;
  }
  return null;
}

export { getFfmpegExe };

export function ffmpegConcat(segments, format, outputDir, ffmpegDir) {
  const ffExe = getFfmpegExe(ffmpegDir);
  if (!ffExe) throw new Error('ffmpeg 未安装');

  const inputFiles = [];
  const tempFiles = [];
  const outDir = outputDir;

  for (const seg of segments) {
    if (seg.output_path && fs.existsSync(seg.output_path)) {
      inputFiles.push(seg.output_path);
    } else {
      const tmpPath = path.join(outDir, `_seg_${inputFiles.length}_${Date.now()}.${format}`);
      fs.writeFileSync(tmpPath, seg.audio);
      inputFiles.push(tmpPath);
      tempFiles.push(tmpPath);
    }
  }

  const listPath = path.join(outDir, `_concat_${Date.now()}.txt`);
  fs.writeFileSync(listPath, inputFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n'));

  const outFile = path.join(outDir, `_concatout_${Date.now()}.${format}`);

  return new Promise((resolve, reject) => {
    const proc = spawn(ffExe, ['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outFile, '-y'],
      { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', code => {
      try { fs.unlinkSync(listPath); } catch {}
      for (const f of tempFiles) try { fs.unlinkSync(f); } catch {}

      if (code !== 0) {
        reject(new Error(`ffmpeg concat 失败: ${stderr.slice(-200)}`));
        return;
      }
      try {
        resolve(fs.readFileSync(outFile));
      } catch (e) {
        reject(e);
      }
    });

    proc.on('error', e => {
      try { fs.unlinkSync(listPath); } catch {}
      for (const f of tempFiles) try { fs.unlinkSync(f); } catch {}
      reject(new Error(`ffmpeg concat 启动失败: ${e.message}`));
    });
  });
}

export function ffmpegConvert(inputPath, targetFormat, ffmpegDir) {
  const ffExe = getFfmpegExe(ffmpegDir);
  if (!ffExe) throw new Error('ffmpeg 未安装');

  const outPath = inputPath.replace(/\.[^.]+$/, `.${targetFormat}`);
  const codecArgs = {
    mp3:  ['-codec:a', 'libmp3lame', '-b:a', '192k'],
    flac: ['-c:a', 'flac'],
    opus: ['-c:a', 'libopus', '-b:a', '96k'],
  };
  const args = ['-i', inputPath, ...(codecArgs[targetFormat] || []), outPath, '-y'];

  return new Promise((resolve, reject) => {
    const proc = spawn(ffExe, args);
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`ffmpeg convert 失败: ${stderr.slice(-200)}`));
      try { resolve(fs.readFileSync(outPath)); } catch (e) { reject(e); }
    });
    proc.on('error', e => reject(new Error(`ffmpeg convert 错误: ${e.message}`)));
  });
}
