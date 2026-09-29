#!/usr/bin/env node
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import * as git from './lib/git.mjs';
import { ensure } from './lib/worktree.mjs';
import { writeReport } from './report.mjs';
import { isMainModule } from './lib/cli.mjs';

const exec = promisify(execFile);
const TEMPLATE = path.resolve(import.meta.dirname, '../../web/index.html');

/**
 * Best-effort only: if the OS has no default browser, or the desktop is
 * headless (SSH, CI), or a tab is already open on this exact file and the
 * window manager just focuses it instead of visibly changing anything, the
 * user is left staring at nothing with no idea whether it worked. The caller
 * must not treat a false return as fatal — it should fall back to printing
 * the URL instead.
 */
export async function openInBrowser(filePath) {
  const opener = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
    : 'xdg-open';
  try {
    await exec(opener, [filePath]);
    return true;
  } catch {
    return false;
  }
}

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

  if (open) await openInBrowser(out);
  return out;
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({ options: {
    repo: { type: 'string', default: process.cwd() },
    'no-open': { type: 'boolean', default: false },
  } });
  // The render() function's own auto-open is best-effort and silent by
  // design (it's also called from the quiz flow, where a failed open
  // shouldn't interrupt anything). The CLI is where a human is actually
  // looking at the output, so it opens explicitly here and always prints a
  // clickable link — a bare filesystem path isn't reliably clickable in a
  // terminal, but a file:// URL is.
  const out = await render(values.repo, { open: false });
  const url = pathToFileURL(out).href;
  const opened = values['no-open'] ? false : await openInBrowser(out);

  if (opened) process.stdout.write('已在瀏覽器打開地圖，沒看到的話點這個連結：\n');
  else if (!values['no-open']) process.stdout.write('沒辦法自動打開瀏覽器，請點這個連結：\n');
  process.stdout.write(url + '\n');
}
