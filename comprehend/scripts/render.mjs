#!/usr/bin/env node
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { promisify } from 'node:util';
import * as git from './lib/git.mjs';
import { ensure } from './lib/worktree.mjs';
import { writeReport } from './report.mjs';

const exec = promisify(execFile);
const TEMPLATE = path.resolve(import.meta.dirname, '../../web/index.html');

/**
 * Local mode: the page is the same one the site serves, with the report baked
 * in, so nothing has to be pushed before you can look at the map.
 */
export async function render(cwd, { open = true, report } = {}) {
  const repoRoot = await git.repoRoot(cwd);
  // Writes report.json and badge.json too: publish.mjs expects them to exist.
  const data = report ?? (await writeReport(repoRoot));

  let template;
  try {
    template = await fs.readFile(TEMPLATE, 'utf8');
  } catch {
    throw new Error(`page template missing at ${TEMPLATE} — install the skill by linking the kenmap repo, not by copying skill/ alone`);
  }

  const injected = template.replace(
    '</head>',
    `<script>window.__REPORT__ = ${JSON.stringify(data).replace(/</g, '\\u003c')};</script>\n</head>`,
  );
  const out = path.join(await ensure(repoRoot), 'local.html');
  await fs.writeFile(out, injected, 'utf8');

  if (open) {
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
    await exec(opener, [out]).catch(() => {});
  }
  return out;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const { values } = parseArgs({ options: {
    repo: { type: 'string', default: process.cwd() },
    'no-open': { type: 'boolean', default: false },
  } });
  const out = await render(values.repo, { open: !values['no-open'] });
  process.stdout.write(out + '\n');
}
