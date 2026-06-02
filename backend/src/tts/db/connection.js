import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { TTS_DB_PATH } from '../../config/constants.js';

export function openDb() {
  fs.mkdirSync(path.dirname(TTS_DB_PATH), { recursive: true });
  const db = new Database(TTS_DB_PATH);
  db.pragma('journal_mode = WAL');
  return db;
}
