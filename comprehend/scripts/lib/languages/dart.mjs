import path from 'node:path';

const IMPORT = /^\s*(?:import|export)\s+['"]([^'"]+)['"]/gm;

export default {
  id: 'dart',
  extensions: ['.dart'],
  manifestFiles: ['pubspec.yaml'],

  packageName(manifestText) {
    const match = /^name:\s*(\S+)/m.exec(manifestText);
    return match ? match[1].replace(/['"]/g, '') : null;
  },

  // Where `package:<name>/x.dart` resolves to, relative to the manifest.
  sourceRoots: () => ['lib'],

  parseImports(text) {
    const raw = [];
    for (const match of text.matchAll(IMPORT)) raw.push(match[1]);
    return raw;
  },

  resolve(raw, { filePath, packages }) {
    if (raw.startsWith('dart:')) return null;
    if (raw.startsWith('package:')) {
      const rest = raw.slice('package:'.length);
      const slash = rest.indexOf('/');
      if (slash === -1) return null;
      const pkg = packages.find((p) => p.name === rest.slice(0, slash));
      if (!pkg) return null; // third-party package, not our code
      return path.posix.join(pkg.root, 'lib', rest.slice(slash + 1));
    }
    if (raw.includes(':')) return null; // some other scheme we do not resolve
    // Anything left is a relative path; Dart allows it bare, without "./".
    return path.posix.normalize(path.posix.join(path.posix.dirname(filePath), raw));
  },
};
