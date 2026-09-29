import fs from 'node:fs/promises';
import path from 'node:path';
import { RESULTS_FILE } from './config.mjs';

export async function readResults(dir) {
  try {
    const raw = await fs.readFile(path.join(dir, RESULTS_FILE), 'utf8');
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
