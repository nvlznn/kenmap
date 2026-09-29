#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { isMainModule } from './lib/cli.mjs';
import * as git from './lib/git.mjs';
import { openInBrowser } from './lib/site.mjs';
import { sync } from './publish.mjs';
import { writeReport } from './report.mjs';

/**
 * Brings the site up to date and opens it. Scores also move without an
 * answer — a rewrite raises churn — and the site only sees what was pushed,
 * so this rescores and syncs before handing out the link.
 */
export async function site(cwd, { open = true } = {}) {
  const repoRoot = await git.repoRoot(cwd);
  await writeReport(repoRoot);
  const result = await sync(repoRoot);
  const opened = open && result.map ? await openInBrowser(result.map) : false;
  return { ...result, opened };
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({ options: {
    repo: { type: 'string', default: process.cwd() },
    'no-open': { type: 'boolean', default: false },
  } });
  const result = await site(values.repo, { open: !values['no-open'] });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
