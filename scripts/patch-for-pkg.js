#!/usr/bin/env node
// Patches undici's runtime-features.js before running pkg.
// pkg statically detects `require('node:sqlite')` and tries to bundle it,
// but node:sqlite is a Node 22+ built-in with no file path. The patch
// replaces the literal require with an indirect call that pkg's walker skips.

const fs = require('fs');
const path = require('path');

// Each entry: [relPath, searchString, replaceString]
// All replacements use an indirect `_r` variable so pkg's static
// require-walker does not pick up the 'node:sqlite' literal.
const patches = [
  // @tensorflow/tfjs-node — uses @mapbox/node-pre-gyp to locate tfjs_binding.node.
  // Inside pkg, __dirname resolves to the snapshot and node-pre-gyp returns a
  // snapshot path that can't be dlopen'd. Intercept when process.pkg is set and
  // redirect to the real file next to the binary (placed there by pkg-fix.sh).
  [
    'node_modules/@tensorflow/tfjs-node/dist/index.js',
    `// tslint:disable-next-line:no-require-imports\nvar binary = require('@mapbox/node-pre-gyp');\nvar bindingPath = binary.find(path.resolve(path.join(__dirname, '/../package.json')));`,
    `var bindingPath;\nif (process.pkg) {\n  bindingPath = require('path').join(require('path').dirname(process.execPath), '@tensorflow', 'tfjs-node', 'lib', 'napi-v8', 'tfjs_binding.node');\n} else {\n  // tslint:disable-next-line:no-require-imports\n  var binary = require('@mapbox/node-pre-gyp');\n  bindingPath = binary.find(path.resolve(path.join(__dirname, '/../package.json')));\n}`,
  ],
  // runtime-features.js — lazy loader map
  [
    'node_modules/cheerio/node_modules/undici/lib/util/runtime-features.js',
    `'node:sqlite': () => require('node:sqlite')`,
    `'node:sqlite': () => { const _r = require; return _r('node:sqlite'); }`,
  ],
  [
    'node_modules/undici/lib/util/runtime-features.js',
    `'node:sqlite': () => require('node:sqlite')`,
    `'node:sqlite': () => { const _r = require; return _r('node:sqlite'); }`,
  ],
  // sqlite-cache-store.js — conditional dynamic load
  [
    'node_modules/cheerio/node_modules/undici/lib/cache/sqlite-cache-store.js',
    `require('node:sqlite').DatabaseSync`,
    `(function(){ const _r = require; return _r('node:sqlite'); })().DatabaseSync`,
  ],
  [
    'node_modules/undici/lib/cache/sqlite-cache-store.js',
    `require('node:sqlite').DatabaseSync`,
    `(function(){ const _r = require; return _r('node:sqlite'); })().DatabaseSync`,
  ],
];

let patched = 0;
for (const [rel, before, after] of patches) {
  const file = path.resolve(rel);
  if (!fs.existsSync(file)) continue;

  let src = fs.readFileSync(file, 'utf8');
  if (src.includes(before)) {
    fs.writeFileSync(file, src.replace(before, after));
    console.log(`Patched ${rel}`);
    patched++;
  } else if (src.includes(after)) {
    console.log(`Already patched: ${rel}`);
    patched++;
  } else {
    console.warn(`Pattern not found in ${rel} — skipping`);
  }
}

if (patched === 0) {
  console.warn('No files patched — undici may have been updated. Check pkg build output.');
}
