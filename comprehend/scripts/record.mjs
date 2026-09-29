#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { RESULTS_FILE, SCORE_STEPS } from './lib/config.mjs';
import * as config from './lib/config.mjs';
import * as git from './lib/git.mjs';
import { ensure } from './lib/worktree.mjs';
import { isMainModule } from './lib/cli.mjs';
import { pathToFileURL } from 'node:url';
import { openInBrowser, render } from './render.mjs';
import { report, writeReport } from './report.mjs';
import { describe } from './structure.mjs';

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

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({ options: {
    repo: { type: 'string', default: process.cwd() },
    module: { type: 'string' },
    score: { type: 'string' },
    question: { type: 'string' },
    answer: { type: 'string', default: '' },
    rationale: { type: 'string', default: '' },
    level: { type: 'string', default: 'design' },
    render: { type: 'boolean', default: false },
    'no-open': { type: 'boolean', default: false },
  } });
  const entry = { ...values, score: Number(values.score) };
  if (!values.render) {
    const result = await record(values.repo, entry);
    process.stdout.write(JSON.stringify(result.entry, null, 2) + '\n');
  } else {
    // One call instead of record → report → render: every extra tool call is
    // a round trip the user sits through. Scoring before and after costs
    // milliseconds here and lets the reply show what the answer changed.
    const repoRoot = await git.repoRoot(values.repo);
    const described = await describe(repoRoot);
    const before = await report(repoRoot, { described });
    await record(repoRoot, entry);
    const after = await writeReport(repoRoot, { described });
    const page = await render(repoRoot, { open: false, report: after });
    const was = before.modules.find((m) => m.id === values.module);
    const now = after.modules.find((m) => m.id === values.module);
    process.stdout.write(JSON.stringify({
      module: values.module,
      moduleBefore: was?.quizzed ? was.score : null,
      moduleAfter: now?.score ?? null,
      totalBefore: before.anyQuizzed ? before.total : null,
      totalAfter: after.total,
      map: pathToFileURL(page).href,
      opened: values['no-open'] ? false : await openInBrowser(page),
    }, null, 2) + '\n');
  }
}
