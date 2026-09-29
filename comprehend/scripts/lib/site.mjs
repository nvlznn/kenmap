import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SITE_URL } from './config.mjs';
import * as git from './git.mjs';

const exec = promisify(execFile);

/**
 * owner/name from a GitHub remote URL, in any of the forms git accepts:
 * git@github.com:o/n.git, https://github.com/o/n(.git), ssh://git@github.com/o/n.git.
 * Anything not on github.com gives null: the site reads data from GitHub only.
 */
export function githubRepo(remoteUrl) {
  const match = /^(?:git@github\.com:|(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com\/)([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/
    .exec(String(remoteUrl).trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

export async function originRepo(repoRoot) {
  try {
    return githubRepo(await git.raw(repoRoot, ['remote', 'get-url', 'origin']));
  } catch {
    return null; // no origin at all
  }
}

export const mapUrl = (fullName) => `${SITE_URL}/?repo=${fullName}`;

/** Best-effort: false when there is no browser to open (SSH, CI); the caller prints the link anyway. */
export async function openInBrowser(target) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    await exec(opener, [target]);
    return true;
  } catch {
    return false;
  }
}
