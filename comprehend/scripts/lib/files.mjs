import path from 'node:path';

const SNIFF_BYTES = 8192;

/**
 * Extension deny-lists miss too much. A NUL byte in the first 8 KB catches
 * real binaries and also UTF-16 text, which Buffer.toString('utf8') would
 * otherwise turn into plausible-looking garbage lines instead of throwing.
 */
export function isBinary(buf) {
  return buf.subarray(0, SNIFF_BYTES).includes(0);
}

export function countLines(buf) {
  if (isBinary(buf)) return null;
  let lines = 0;
  for (const line of buf.toString('utf8').split('\n')) {
    if (line.trim() !== '') lines++;
  }
  return lines;
}

export function extensionOf(filePath) {
  const base = path.basename(filePath);
  const ext = path.extname(base);
  if (ext) return ext.toLowerCase();
  return base; // Makefile, Dockerfile, LICENSE — the name is the only signal
}

const GENERATED_SEGMENTS = new Set([
  'generated', 'gen', 'node_modules', 'vendor', 'dist', 'build', 'target', '.dart_tool',
]);
const GENERATED_NAME = /\.(g|freezed|gr|pb|mocks|config)\.[^.]+$|_pb2?\.[^.]+$|\.min\.[^.]+$/;

/**
 * Advisory only — never used to silently drop files. Excluding a file removes
 * it from the denominator, which inflates the repo score.
 * Segment equality, not substring: "dist" as a substring also hits
 * "redistribute/", and Go's vendor/ can hold real dependencies.
 */
export function looksGenerated(filePath, { linguistGenerated = false } = {}) {
  if (linguistGenerated) return true;
  const segments = filePath.split('/');
  if (segments.slice(0, -1).some((s) => GENERATED_SEGMENTS.has(s))) return true;
  return GENERATED_NAME.test(path.basename(filePath));
}

/** First match wins, matching the documented config rule. */
export function moduleOf(filePath, modules) {
  for (const [id, globs] of Object.entries(modules)) {
    for (const glob of globs) {
      if (path.matchesGlob(filePath, glob)) return id;
    }
  }
  return null;
}

export function assignModules(files, modules) {
  const assigned = new Map(Object.keys(modules).map((id) => [id, []]));
  const multiMatch = [];
  for (const file of files) {
    const matches = Object.entries(modules)
      .filter(([, globs]) => globs.some((g) => path.matchesGlob(file.path, g)))
      .map(([id]) => id);
    if (matches.length === 0) continue;
    if (matches.length > 1) multiMatch.push({ path: file.path, matches });
    assigned.get(matches[0]).push(file);
  }
  return { assigned, multiMatch };
}
