'use strict';
// Exa for Windows: the parts that do not need Electron, so they can be tested on their own.
const fs = require('fs');
const path = require('path');

const LIMITS = { maxFiles: 8, maxFile: 6 * 1024 * 1024, maxBundle: 15 * 1024 * 1024 };
const DEFAULT_API = 'https://openwist-poc.onrender.com';
const DEFAULT_SITE = 'https://exa.openwist.com';
const MAX_ENTRIES = 1000;
const HIDDEN = /^(desktop\.ini|thumbs\.db|\.ds_store)$/i;

const MIME = {
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const mimeFor = (name) => MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';

// What the right-click menu runs:  Exa.exe "--ask=<path>"
// Chromium moves loose arguments to the end of the command line, after every switch (it turned `--ask "C:\x"` into
// `--ask --allow-file-access-from-files "C:\x"`), so the path is passed inside the switch itself. The older two-part form
// is still understood: the last argument that is not a switch is the path.
function parseArgs(argv) {
  const a = (Array.isArray(argv) ? argv : []).slice(1).map(String);
  const hidden = a.includes('--hidden');
  const clean = (v) => String(v).replace(/^"+|"+$/g, '');
  const eq = a.find((x) => x.startsWith('--ask='));
  if (eq) { const v = clean(eq.slice(6)); return v ? { ask: v, hidden: false } : { ask: null, hidden }; }
  if (a.includes('--ask')) {
    const loose = a.filter((x) => !x.startsWith('--'));
    if (loose.length) return { ask: clean(loose[loose.length - 1]), hidden: false };
  }
  return { ask: null, hidden };
}

const same = (x, y) => (process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y);
// True when p is root itself or something inside it. Used so the picker can never read outside the folder the person chose.
function isInside(root, p) {
  const r = path.resolve(root), t = path.resolve(p);
  if (same(r, t)) return true;
  const rel = path.relative(r, t);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function listDir(root, dir) {
  if (!isInside(root, dir)) throw new Error('That folder is outside the one you chose.');
  const items = [];
  let names = fs.readdirSync(dir);
  const truncated = names.length > MAX_ENTRIES * 2;
  for (const n of names) {
    if (n.startsWith('.') || n.startsWith('~$') || HIDDEN.test(n)) continue;
    const full = path.join(dir, n);
    let st; try { st = fs.statSync(full); } catch (_) { continue; }     // broken links and locked items are left out
    const isDir = st.isDirectory();
    if (!isDir && !st.isFile()) continue;
    items.push({ name: n, path: full, dir: isDir, size: isDir ? 0 : st.size, mtime: st.mtime.toISOString().slice(0, 10) });
  }
  items.sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })));
  const atRoot = same(path.resolve(root), path.resolve(dir));
  return {
    dir, name: path.basename(dir) || dir, atRoot, parent: atRoot ? null : path.dirname(dir),
    entries: items.slice(0, MAX_ENTRIES), more: items.length > MAX_ENTRIES || truncated, limits: LIMITS,
  };
}

// Reads the chosen files for sending. Every path is checked again here; the picker is not trusted.
function buildBundle(paths, root, origin, name) {
  if (!Array.isArray(paths) || !paths.length) throw new Error('Choose at least one file.');
  if (paths.length > LIMITS.maxFiles) throw new Error(`Choose ${LIMITS.maxFiles} files or fewer.`);
  const seen = new Set(); const files = []; let total = 0;
  for (const p of paths) {
    if (typeof p !== 'string' || !isInside(root, p)) throw new Error('One of the files is outside the folder you chose.');
    const key = path.resolve(p).toLowerCase();
    if (seen.has(key)) continue; seen.add(key);
    let st; try { st = fs.statSync(p); } catch (_) { throw new Error(`Could not read ${path.basename(p)}.`); }
    if (!st.isFile()) throw new Error(`${path.basename(p)} is not a file.`);
    if (st.size === 0) throw new Error(`${path.basename(p)} is empty.`);
    if (st.size > LIMITS.maxFile) throw new Error(`${path.basename(p)} is over 6 MB, which is the most Exa can take from one file.`);
    total += st.size;
    if (total > LIMITS.maxBundle) throw new Error('Those files are over 15 MB together. Choose fewer.');
    let buf; try { buf = fs.readFileSync(p); } catch (_) { throw new Error(`Could not read ${path.basename(p)}. Is it open in another program?`); }
    files.push({ name: path.basename(p), mime: mimeFor(p), b64: buf.toString('base64') });
  }
  return { kind: 'bundle', origin: origin === 'folder' ? 'folder' : 'file', name: name || 'Files', files };
}

async function postHandoff(api, bundle, fetchImpl) {
  const f = fetchImpl || fetch;
  let r;
  try {
    r = await f(String(api).replace(/\/+$/, '') + '/api/handoff', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(bundle),
    });
  } catch (_) { throw new Error('Ask Exa could not reach Exa. Check your internet connection and try again.'); }
  if (r.status === 429) throw new Error('You used Ask Exa a lot in a short time. Wait a minute and try again.');
  if (r.status === 413) throw new Error('That is too big for Ask Exa to send.');
  let j = null; try { j = await r.json(); } catch (_) {}
  if (!r.ok || !j || !/^[0-9a-f]{32}$/.test(j.id || '')) throw new Error('Exa sent back something unexpected. Try again.');
  return j.id;
}

const handoffUrl = (site, id) => String(site).replace(/\/+$/, '') + '/new?handoff=' + id;

module.exports = { LIMITS, DEFAULT_API, DEFAULT_SITE, parseArgs, isInside, listDir, buildBundle, postHandoff, handoffUrl, mimeFor };
