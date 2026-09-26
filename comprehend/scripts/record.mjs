#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { RESULTS_FILE, SCORE_STEPS } from './lib/config.mjs';
import * as config from './lib/config.mjs';
import * as git from './lib/git.mjs';
import { ensure } from './lib/worktree.mjs';

/** One quiz is one question is one record. */
export async function record(cwd, entry, { now = new Date() } = {}) {
  const repoRoot = await git.repoRoot(cwd);
  const conf = await config.read(repoRoot);

  if (!Object.hasOwn(conf.modules, entry.module)) {
    throw new Error(`unknown module "${entry.module}" — known: ${Object.keys(conf.modules).join(', ')}`);
  }
  if (!SCORE_STEPS.includes(entry.score)) {
    throw new Error(`score must be one of ${SCORE_STEPS.join(' / ')}, got ${entry.score}`);
  }
  if (!entry.question?.trim()) throw new Error('question text is required — the score has to be auditable');

  const line = {
    user: conf.user,
    module: entry.module,
    commit: await git.headCommit(repoRoot),
    at: now.toISOString(),
    level: entry.level ?? 'design',
    score: entry.score,
    question: entry.question,
    answer: entry.answer ?? '',
    rationale: entry.rationale ?? '',
  };

  const dir = await ensure(repoRoot);
  await fs.appendFile(path.join(dir, RESULTS_FILE), JSON.stringify(line) + '\n', 'utf8');
  return { file: path.join(dir, RESULTS_FILE), entry: line };
}

export async function readResults(dir) {
  try {
    const raw = await fs.readFile(path.join(dir, RESULTS_FILE), 'utf8');
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const { values } = parseArgs({ options: {
    repo: { type: 'string', default: process.cwd() },
    module: { type: 'string' },
    score: { type: 'string' },
    question: { type: 'string' },
    answer: { type: 'string', default: '' },
    rationale: { type: 'string', default: '' },
    level: { type: 'string', default: 'design' },
  } });
  const result = await record(values.repo, { ...values, score: Number(values.score) });
  process.stdout.write(JSON.stringify(result.entry, null, 2) + '\n');
}
