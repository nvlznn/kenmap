import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * process.argv[1] keeps the path exactly as it was typed on the command
 * line; import.meta.url resolves through any symlinks in the chain, because
 * that is how Node identifies the module for its cache. A plain string
 * comparison of the two breaks for every script here once installed the
 * documented way (`ln -s ... ~/.claude/skills/comprehend`) — and even
 * without that, macOS's /tmp is itself a symlink to /private/tmp. Comparing
 * realpaths on both sides survives any of it. On failure (e.g. argv[1] does
 * not exist), treat the module as not the entry point rather than throwing.
 */
export function isMainModule(moduleUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
