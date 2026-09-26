#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { BADGE_FILE, RECENT_RECORDS, REPORT_FILE } from './lib/config.mjs';
import { countLines, isBinary } from './lib/files.mjs';
import * as git from './lib/git.mjs';
import { ensure } from './lib/worktree.mjs';
import { readResults } from './record.mjs';
import { scan } from './scan.mjs';

/** Module line counts at an arbitrary commit, reading only the blobs we need. */
async function locAtCommit(repoRoot, commit, modules) {
  const tracked = await git.listTree(repoRoot, commit);
  const wanted = tracked.filter((f) => modules.some((m) => m.globs.some((g) => path.matchesGlob(f.path, g))));
  const blobs = await git.readBlobs(repoRoot, wanted.map((f) => f.sha));
  const loc = new Map(modules.map((m) => [m.id, 0]));
  for (const file of wanted) {
    const module = modules.find((m) => m.globs.some((g) => path.matchesGlob(file.path, g)));
    const blob = blobs.get(file.sha);
    if (!module || !blob || isBinary(blob)) continue;
    loc.set(module.id, loc.get(module.id) + countLines(blob));
  }
  return loc;
}

function moduleOfPath(filePath, modules) {
  return modules.find((m) => m.globs.some((g) => path.matchesGlob(filePath, g)))?.id ?? null;
}

/**
 * One repo-wide diff per baseline, bucketed here. A per-module pathspec diff
 * cannot see a file moving between modules: the origin reads as fully deleted
 * and the destination as fully added, spiking churn to 1 on both sides.
 */
async function churnFrom(repoRoot, base, modules) {
  const changes = await git.diffNumstat(repoRoot, base);
  const totals = new Map(modules.map((m) => [m.id, { added: 0, deleted: 0 }]));
  for (const change of changes) {
    if (change.added === null || change.deleted === null) continue; // binary: "-\t-"
    for (const id of new Set([moduleOfPath(change.path, modules), change.oldPath && moduleOfPath(change.oldPath, modules)])) {
      if (!id) continue;
      const entry = totals.get(id);
      entry.added += change.added;
      entry.deleted += change.deleted;
    }
  }
  return totals;
}

/** Resolves the baseline a record should be measured against. */
async function baselineFor(repoRoot, record) {
  if (await git.commitExists(repoRoot, record.commit)) return { commit: record.commit, recovered: false };
  const recovered = await git.commitAtTime(repoRoot, record.at);
  if (recovered) return { commit: recovered, recovered: true };
  return { commit: null, recovered: false };
}

export async function report(repoRoot, { now = new Date() } = {}) {
  const scanned = await scan(repoRoot);
  const dataDir = await ensure(repoRoot);
  const results = await readResults(dataDir);
  const modules = scanned.modules;
  const warnings = [...scanned.warnings];

  const byModule = new Map(modules.map((m) => [m.id, []]));
  for (const result of results) {
    if (byModule.has(result.module)) byModule.get(result.module).push(result);
    else warnings.push(`result for unknown module "${result.module}" ignored — was it renamed?`);
  }

  // Per-call: keyed by baseline commit but computed against the current HEAD,
  // so they must not survive into a run where HEAD has moved.
  const baselines = new Map();
  const churnCache = new Map();
  const locCache = new Map();
  const scored = [];
  for (const module of modules) {
    // results.jsonl is append-only, so a later line wins a timestamp tie.
    const recent = byModule.get(module.id)
      .map((record, index) => ({ record, index }))
      .sort((a, b) => b.record.at.localeCompare(a.record.at) || b.index - a.index)
      .slice(0, RECENT_RECORDS)
      .map(({ record }) => record);

    const breakdown = [];
    for (const record of recent) {
      const key = `${record.commit}\u0000${record.at}`;
      if (!baselines.has(key)) baselines.set(key, await baselineFor(repoRoot, record));
      const baseline = baselines.get(key);

      if (!baseline.commit) {
        warnings.push(`${module.id}: baseline for the ${record.at} answer is gone, churn unverifiable`);
        breakdown.push({ at: record.at, quizScore: record.score, churn: null, score: record.score, baseline: null });
        continue;
      }
      if (!churnCache.has(baseline.commit)) {
        churnCache.set(baseline.commit, await churnFrom(repoRoot, baseline.commit, modules));
      }
      if (!locCache.has(baseline.commit)) {
        locCache.set(baseline.commit, await locAtCommit(repoRoot, baseline.commit, modules));
      }
      const { added, deleted } = churnCache.get(baseline.commit).get(module.id);
      const locThen = locCache.get(baseline.commit).get(module.id) ?? 0;
      const denominator = Math.max(locThen, module.loc);
      // max(), not added+deleted: git records a one-line edit as 1 added and
      // 1 deleted, which would double-count every edit.
      const churn = denominator === 0 ? 0 : Math.min(1, Math.max(added, deleted) / denominator);
      breakdown.push({
        at: record.at,
        quizScore: record.score,
        churn: round(churn),
        score: round(record.score * (1 - churn)),
        baseline: baseline.recovered ? { commit: baseline.commit, recovered: true } : { commit: baseline.commit },
      });
    }

    const usable = breakdown.filter((b) => b.score !== null);
    const score = usable.length === 0 ? 0 : round(usable.reduce((n, b) => n + b.score, 0) / usable.length);
    scored.push({
      id: module.id,
      loc: module.loc,
      fileCount: module.fileCount,
      generatedFiles: module.generatedFiles,
      score,
      quizzed: recent.length > 0,
      breakdown,
    });
  }

  const weighted = scored.filter((m) => m.loc > 0);
  const totalLoc = weighted.reduce((n, m) => n + m.loc, 0);
  const total = totalLoc === 0 ? 0 : round(weighted.reduce((n, m) => n + m.score * m.loc, 0) / totalLoc);

  return {
    generatedAt: now.toISOString(),
    commit: scanned.commit,
    total,
    anyQuizzed: scored.some((m) => m.quizzed),
    modules: scored,
    edges: scanned.edges,
    unassigned: scanned.unassigned,
    warnings,
  };
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

export function badge(report) {
  if (!report.anyQuizzed) {
    return { schemaVersion: 1, label: 'comprehension', message: 'no data', color: 'lightgrey' };
  }
  const percent = Math.round(report.total * 100);
  const color = percent < 40 ? 'red' : percent < 70 ? 'yellow' : 'brightgreen';
  return { schemaVersion: 1, label: 'comprehension', message: `${percent}%`, color };
}

export async function writeReport(repoRoot, options) {
  const result = await report(repoRoot, options);
  const dir = await ensure(repoRoot);
  await fs.writeFile(path.join(dir, REPORT_FILE), JSON.stringify(result, null, 2) + '\n', 'utf8');
  await fs.writeFile(path.join(dir, BADGE_FILE), JSON.stringify(badge(result), null, 2) + '\n', 'utf8');
  return result;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const { values } = parseArgs({ options: { repo: { type: 'string', default: process.cwd() } } });
  const repoRoot = await git.repoRoot(values.repo);
  const result = await writeReport(repoRoot);
  process.stdout.write(JSON.stringify({ total: result.total, modules: result.modules.map((m) => ({ id: m.id, score: m.score, loc: m.loc })), warnings: result.warnings }, null, 2) + '\n');
}
