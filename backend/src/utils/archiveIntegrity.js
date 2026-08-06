import fs from 'fs';
import fsp from 'fs/promises';
import crypto from 'crypto';

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

/**
 * 校验元数据格式（不再阻塞，仅 warn 格式异常）
 */
export function validateArchiveMetadata({ size, sha256 } = {}) {
  if (!Number.isSafeInteger(size) || size <= 0) {
    // 缺少 size → 后续 size 校验跳过，用实际文件大小兜底
    return;
  }
  if (sha256 != null && !SHA256_PATTERN.test(sha256)) {
    console.warn(`[archive-integrity] sha256 格式无效，已跳过: ${sha256}`);
  }
}

/**
 * 校验下载文件完整性，线性逐步降级：
 *
 *   1. validateMetadata — 预检，不阻塞
 *   2. stat 取文件大小    — 文件不存在则抛错
 *   3. size 校验          — 有有效 size 则严格比对，否则 warn 跳过
 *   4. sha256 格式检查    — 完全无 → return 放行；格式错 → warn 返回
 *   5. sha256 哈希比对    — 计算文件摘要并比对，不匹配则抛错
 *
 * ─── 四种配置对应的校验 ───
 *   size ✅ + sha256 ✅  → size 比对 + sha256 哈希严格校验
 *   size ✅ + sha256 ❌  → 仅 size 比对，哈希跳过
 *   size ❌ + sha256 ✅  → size 跳过（warn），sha256 哈希严格校验
 *   size ❌ + sha256 ❌  → 全部跳过（两次 warn），文件存在即放行
 */
export async function verifyArchiveIntegrity(filePath, metadata) {
  // [1] 预检
  validateArchiveMetadata(metadata);

  // [2] 文件必须存在
  const stat = await fsp.stat(filePath);

  // [3] size 校验 — 有有效值才严格比对
  if (Number.isSafeInteger(metadata.size) && metadata.size > 0) {
    if (stat.size !== metadata.size) {
      throw new Error(`下载文件大小不匹配：期望 ${metadata.size} 字节，实际 ${stat.size} 字节`);
    }
  } else {
    console.warn(`[archive-integrity] 缺少有效的 size 信息，跳过大小校验 (实际: ${stat.size} 字节)`);
  }

  // [4] sha256 检查 — 完全无 → 放行；格式错 → warn 跳过
  if (!metadata.sha256) return;
  if (!SHA256_PATTERN.test(metadata.sha256)) {
    console.warn(`[archive-integrity] sha256 格式无效，跳过哈希校验`);
    return;
  }

  // [5] 计算摘要并比对
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });

  const actualHash = hash.digest('hex');
  if (actualHash.toLowerCase() !== metadata.sha256.toLowerCase()) {
    throw new Error('下载文件 SHA-256 校验失败，请重新下载');
  }
}
