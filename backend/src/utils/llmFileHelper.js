import fs from 'fs';
import path from 'path';

export function isMmprojFile(name = '') {
  const lowerName = name.toLowerCase();
  return lowerName.endsWith('.gguf') && lowerName.startsWith('mmproj');
}

export function isDflashFile(name = '') {
  const lowerName = name.toLowerCase();
  return lowerName.endsWith('.gguf') && lowerName.includes('dflash');
}

export function isDsparkFile(name = '') {
  const lowerName = name.toLowerCase();
  return lowerName.endsWith('.gguf') && lowerName.includes('dspark');
}

export function isAuxiliaryLlmFile(name = '') {
  return isMmprojFile(name) || isDflashFile(name) || isDsparkFile(name);
}

export function pickAuxiliaryFile(options = [], selectedName = null) {
  if (!Array.isArray(options) || options.length === 0) {
    return null;
  }

  if (selectedName) {
    const selected = options.find(option => option.name === selectedName);
    if (selected) {
      return selected;
    }
  }

  return options[0] || null;
}

export function findAuxiliaryFilePath(localPath, matcher) {
  if (typeof localPath !== 'string' || !localPath || typeof matcher !== 'function') {
    return null;
  }

  if (!fs.existsSync(localPath) || !fs.statSync(localPath).isDirectory()) {
    return null;
  }

  const files = fs.readdirSync(localPath);
  const matchedFile = files.find(file => matcher(file));

  return matchedFile ? path.join(localPath, matchedFile) : null;
}
