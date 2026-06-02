/**
 * Voice ID 生成工具。
 *
 * 算法：MD5 → 前 4 字节 → base25 → 6 位无歧义字符。
 * 排除所有易混淆字符（0/O, 1/I/L, 2/Z, 5/S, 8/B），共 25 字符。
 */
import crypto from 'crypto';

export const ID_ALPHABET = '34679ACDEFGHJKMNPQRTUVWXY';

const BASE = ID_ALPHABET.length;

/** MD5 前 4 字节 → base25 → 6 位 ID */
export function idFromMd5Bytes(md5Bytes) {
  const num = md5Bytes.readUInt32BE(0);
  let id = '';
  let n = num;
  for (let i = 0; i < 6; i++) {
    id = ID_ALPHABET[n % BASE] + id;
    n = Math.floor(n / BASE);
  }
  return id;
}

/** 字符串 → MD5 → 6 位 Voice ID */
export function generateVoiceId(input) {
  const md5 = crypto.createHash('md5').update(input).digest();
  return idFromMd5Bytes(md5);
}
