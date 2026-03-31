// AES-256-CBC 加解密工具，用于保护存储在数据库中的 API 密钥
import crypto from 'crypto';

// 固定密钥（32字节）和初始向量（16字节），用于本地存储加密
// 此密钥仅用于本地数据混淆，防止明文存储
const KEY = Buffer.from('NovaMax_ApiKey_Encrypt_Key_2024!', 'utf8'); // 32 bytes
const IV  = Buffer.from('NovaMax_IV_2024!', 'utf8');                 // 16 bytes

/**
 * 加密文本，返回 base64 字符串
 */
export function encrypt(text) {
  if (!text) return text;
  const cipher = crypto.createCipheriv('aes-256-cbc', KEY, IV);
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

/**
 * 解密文本，输入为 base64 字符串，输出解密后的文本
 */
export function decrypt(value) {
  if (!value) return value;
  const decipher = crypto.createDecipheriv('aes-256-cbc', KEY, IV);
  let decrypted = decipher.update(value, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
