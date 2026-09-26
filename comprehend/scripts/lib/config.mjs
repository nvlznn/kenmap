import fs from 'node:fs/promises';
import path from 'node:path';

export const CONFIG_FILENAME = '.kenmap.json';
export const DATA_BRANCH = 'kenmap-data';
export const DATA_DIR = '.kenmap-data';
export const RESULTS_FILE = 'results.jsonl';
export const REPORT_FILE = 'report.json';
export const BADGE_FILE = 'badge.json';

/** One question per quiz, graded on a five-step scale. */
export const SCORE_STEPS = [0, 0.25, 0.5, 0.75, 1];
/** A module's score averages its most recent records, each churn-adjusted. */
export const RECENT_RECORDS = 3;

export class ConfigError extends Error {}

export function configPath(repoRoot) {
  return path.join(repoRoot, CONFIG_FILENAME);
}

export async function exists(repoRoot) {
  try {
    await fs.access(configPath(repoRoot));
    return true;
  } catch {
    return false;
  }
}

export async function read(repoRoot) {
  const file = configPath(repoRoot);
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    throw new ConfigError(`${CONFIG_FILENAME} not found in ${repoRoot} — run /comprehend init first`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`${CONFIG_FILENAME} is not valid JSON: ${err.message}`);
  }
  return validate(parsed);
}

export function validate(config) {
  const fail = (msg) => {
    throw new ConfigError(msg);
  };
  if (config === null || typeof config !== 'object' || Array.isArray(config)) fail('config must be an object');
  if (config.version !== 1) fail(`unsupported config version: ${JSON.stringify(config.version)} (expected 1)`);
  if (typeof config.user !== 'string' || config.user.trim() === '') fail('config.user must be a non-empty string');

  const { modules } = config;
  if (modules === null || typeof modules !== 'object' || Array.isArray(modules)) fail('config.modules must be an object');
  const ids = Object.keys(modules);
  if (ids.length === 0) fail('config.modules must define at least one module');

  for (const id of ids) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
      fail(`module id ${JSON.stringify(id)} must be alphanumeric with . _ - and no whitespace`);
    }
    const globs = modules[id];
    if (!Array.isArray(globs) || globs.length === 0) fail(`module ${id} must list at least one glob`);
    for (const glob of globs) {
      if (typeof glob !== 'string' || glob.trim() === '') fail(`module ${id} has an empty glob`);
      if (path.isAbsolute(glob)) fail(`module ${id} glob ${JSON.stringify(glob)} must be relative to the repo root`);
      if (glob.startsWith('../')) fail(`module ${id} glob ${JSON.stringify(glob)} must stay inside the repo`);
    }
  }
  return config;
}

export async function write(repoRoot, config) {
  validate(config);
  await fs.writeFile(configPath(repoRoot), JSON.stringify(config, null, 2) + '\n', 'utf8');
  return configPath(repoRoot);
}
