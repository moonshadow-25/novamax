/** WAV raw concat — ffmpeg 不可用时的回退 */
export function concatWav(buffers) {
  if (buffers.length === 0) return Buffer.alloc(0);
  if (buffers.length === 1) return buffers[0];

  const allWav = buffers.every(b => b.length > 44);
  if (!allWav) return Buffer.concat(buffers);

  const header = buffers[0].slice(0, 44);
  const dataChunks = buffers.map(b => b.slice(44));
  const totalData = Buffer.concat(dataChunks);

  const out = Buffer.alloc(44 + totalData.length);
  header.copy(out, 0, 0, 44);
  totalData.copy(out, 44);
  out.writeUInt32LE(36 + totalData.length, 4);
  out.writeUInt32LE(totalData.length, 40);

  return out;
}
