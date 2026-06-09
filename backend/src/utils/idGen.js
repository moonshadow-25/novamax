import crypto from 'crypto';

export function genId(prefix = '') {
  return `${prefix}${crypto.randomUUID().slice(0, 12)}`;
}

export function fileUuid() {
  return crypto.randomUUID().slice(0, 12);
}
