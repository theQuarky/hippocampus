// src/xenova.ts — pkg-safe @xenova/transformers loader
//
// @xenova/transformers is a pure-ESM package ("type":"module"). Inside a pkg
// binary, Node's ESM resolver can't serve file:// requests from the virtual
// snapshot. We detect process.pkg and load from the real filesystem instead
// (files are placed there by scripts/pkg-fix.sh).
import path from 'path';

let _cache: any = null;

export async function loadXenova(): Promise<any> {
  if (_cache) return _cache;
  if ((process as any).pkg) {
    const entry = path.join(
      path.dirname(process.execPath),
      'node_modules', '@xenova', 'transformers', 'src', 'transformers.js',
    );
    _cache = await import(`file://${entry}`);
  } else {
    _cache = await import('@xenova/transformers');
  }
  return _cache;
}
