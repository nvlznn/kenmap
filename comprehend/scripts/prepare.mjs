#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import * as config from './lib/config.mjs';
import { LEGACY_TYPE, QUESTION_TYPES, REQUIRED_ANSWERS } from './lib/config.mjs';
import { isMainModule } from './lib/cli.mjs';
import * as git from './lib/git.mjs';
import { readResults } from './lib/results.mjs';
import { report } from './report.mjs';
import { resolveModule, scan } from './scan.mjs';
import { describe } from './structure.mjs';

export const DEFAULT_LINES = 1000;
const PREVIOUS_QUESTIONS = 5;

/**
 * Everything the quiz needs before it can ask, in one call: which module,
 * whether that module has uncommitted edits, what was already asked, and the
 * code itself. Each of these used to be a separate tool call, and the user
 * waits through every round trip.
 */
export async function prepare(cwd, { target, lines = DEFAULT_LINES } = {}) {
  const repoRoot = await git.repoRoot(cwd);
  const conf = await config.read(repoRoot);
  const described = await describe(repoRoot);
  const scanned = await scan(repoRoot, conf, described);
  const results = await readResults(path.join(repoRoot, config.DATA_DIR));

  let moduleId;
  if (target) {
    const resolved = resolveModule(scanned, target);
    if (!resolved.moduleId) return { error: resolved.error, candidates: resolved.candidates ?? [] };
    moduleId = resolved.moduleId;
  } else {
    moduleId = await pickWeakest(repoRoot, scanned, described, results);
    if (!moduleId) return { error: 'no module has any lines to quiz on', candidates: [] };
  }
  const module = scanned.modules.find((m) => m.id === moduleId);

  // Only edits inside this module matter: the score binds to HEAD, so
  // uncommitted work elsewhere does not change what is being measured.
  const status = await git.raw(repoRoot, ['status', '--porcelain', '--', ...module.globs.map((g) => `:(glob)${g}`)]);
  const dirty = status.split('\n').filter(Boolean).map((line) => line.slice(3));

  const asked = results.filter((r) => r.module === moduleId);
  return {
    repoRoot,
    commit: described.commit,
    module: { id: module.id, loc: module.loc, fileCount: module.fileCount },
    dirty,
    type: nextType(asked.map((r) => r.type)),
    previous: asked.slice(-PREVIOUS_QUESTIONS).map((r) => ({ type: r.type ?? LEGACY_TYPE, question: r.question })),
    ...pickCode(module, described, lines),
  };
}

/** The type this module has been asked least; ties go to the earlier one in QUESTION_TYPES. */
export function nextType(askedTypes) {
  const counts = new Map(QUESTION_TYPES.map((t) => [t.id, 0]));
  for (const type of askedTypes) {
    const id = type ?? LEGACY_TYPE;
    if (counts.has(id)) counts.set(id, counts.get(id) + 1);
  }
  return QUESTION_TYPES.reduce((best, t) => (counts.get(t.id) < counts.get(best.id) ? t : best));
}

/**
 * Finish what was started: a module part way to its first score comes
 * before a new one, so the map fills in instead of scattering. A module
 * without a score counts as zero by definition, so the churn computation —
 * the slow part — is only needed once every module has a score.
 */
async function pickWeakest(repoRoot, scanned, described, results) {
  const live = scanned.modules.filter((m) => m.loc > 0);
  if (live.length === 0) return null;
  const counts = new Map();
  for (const r of results) counts.set(r.module, (counts.get(r.module) ?? 0) + 1);
  const answered = (m) => counts.get(m.id) ?? 0;

  const started = live.filter((m) => answered(m) > 0 && answered(m) < REQUIRED_ANSWERS);
  if (started.length > 0) return started.sort((a, b) => answered(b) - answered(a) || b.loc - a.loc)[0].id;
  const fresh = live.filter((m) => answered(m) === 0);
  if (fresh.length > 0) return fresh.sort((a, b) => b.loc - a.loc)[0].id;

  const scored = await report(repoRoot, { described });
  return scored.modules
    .filter((m) => m.loc > 0)
    .sort((a, b) => a.score - b.score || b.loc - a.loc)[0].id;
}

/**
 * Files other modules import most go first: they carry the module's
 * contracts, which is what the questions are about. Generated code is left
 * out unless it is all the module has.
 */
function pickCode(module, described, budget) {
  const inModule = new Set(module.files);
  const incoming = new Map();
  for (const edge of described.edges) {
    if (inModule.has(edge.to) && !inModule.has(edge.from)) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  const meta = new Map(described.files.map((f) => [f.path, f]));
  const readable = module.files.map((p) => meta.get(p)).filter((f) => f && !f.binary && f.loc > 0);
  const handWritten = readable.filter((f) => !f.generated);
  const ranked = (handWritten.length ? handWritten : readable)
    .sort((a, b) => (incoming.get(b.path) ?? 0) - (incoming.get(a.path) ?? 0) || b.loc - a.loc);

  const files = [];
  let used = 0;
  for (const file of ranked) {
    const all = described.blobs.get(file.sha).toString('utf8').replace(/\n$/, '').split('\n');
    const room = budget - used;
    if (all.length <= room) {
      files.push({ path: file.path, importedBy: incoming.get(file.path) ?? 0, text: all.join('\n'), truncated: false });
      used += all.length;
      continue;
    }
    if (files.length === 0 || room >= 80) {
      files.push({ path: file.path, importedBy: incoming.get(file.path) ?? 0, text: all.slice(0, room).join('\n'), truncated: true });
    }
    break;
  }
  return { files, shown: files.length, readable: ranked.length, budget };
}

export function format(result) {
  if (result.error) {
    return result.candidates.length
      ? `這個路徑橫跨多個模組：${result.candidates.join('、')}`
      : `錯誤：${result.error}`;
  }
  const head = [
    `模組：${result.module.id}（${result.module.loc} 行、${result.module.fileCount} 檔）· commit ${result.commit.slice(0, 7)}`,
    result.dirty.length
      ? `未 commit 的變更：${result.dirty.join('、')}（分數以目前 commit 為準）`
      : '未 commit 的變更：無',
    `這次題型：${result.type.label}（--type ${result.type.id}）`,
    `顯示 ${result.shown}/${result.readable} 檔（上限 ${result.budget} 行）`,
    result.previous.length
      ? `之前問過（別重複）：\n${result.previous.map((p) =>
        `- [${QUESTION_TYPES.find((t) => t.id === p.type)?.label ?? p.type}] ${p.question}`).join('\n')}`
      : '之前問過：無',
  ];
  // Absolute paths and line numbers are printed here so a question that
  // points at code can cite its exact location by copying, not by counting.
  const body = result.files.map((f) => {
    const lines = f.text.split('\n');
    const width = String(lines.length).length;
    const numbered = lines.map((line, i) => `${String(i + 1).padStart(width)}│${line}`).join('\n');
    const where = path.join(result.repoRoot, f.path);
    return `\n── ${where}${f.importedBy ? `（被其他模組 import ${f.importedBy} 次）` : ''}${f.truncated ? '（截斷）' : ''} ──\n${numbered}`;
  });
  return [...head, ...body].join('\n');
}

if (isMainModule(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      repo: { type: 'string', default: process.cwd() },
      lines: { type: 'string' },
    },
  });
  const result = await prepare(values.repo, {
    target: positionals[0],
    lines: values.lines ? Number(values.lines) : DEFAULT_LINES,
  });
  process.stdout.write(format(result) + '\n');
  if (result.error) process.exitCode = 2;
}
