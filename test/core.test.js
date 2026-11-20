'use strict';
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const core = require('../src/core');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exa-'));
const w = (rel, data) => { const p = path.join(tmp, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); return p; };
w('Docs/a b.pdf', 'pdf'); w('Docs/é ü.csv', 'x,y'); w('Docs/Old/1.txt', 'one'); w('Docs/.secret', 's'); w('Docs/desktop.ini', 'i'); w('Docs/~$lock.docx', 'l'); w('Docs/empty.txt', '');
w('Docs/big.bin', Buffer.alloc(core.LIMITS.maxFile + 1)); w('outside/x.txt', 'no');
const root = path.join(tmp, 'Docs');

test('parseArgs: the form the right-click menu uses, and the order Chromium rewrites it into', () => {
  const P = 'C:\\Users\\x\\My Docs';
  assert.strictEqual(core.parseArgs(['Exa.exe', '--ask=' + P]).ask, P);
  assert.strictEqual(core.parseArgs(['Exa.exe', '--allow-file-access-from-files', '--ask=' + P]).ask, P);
  assert.strictEqual(core.parseArgs(['Exa.exe', '--ask', '--allow-file-access-from-files', P]).ask, P);      // the failure seen on Windows
  assert.strictEqual(core.parseArgs(['Exa.exe', '--ask', '--allow-file-access-from-files']).ask, null);       // never mistakes a switch for a path
  assert.strictEqual(core.parseArgs(['Exa.exe', '--ask=']).ask, null);
  assert.strictEqual(core.parseArgs(['Exa.exe', '--ask="' + P + '"']).ask, P);
});

test('parseArgs', () => {
  assert.deepStrictEqual(core.parseArgs(['Exa.exe', '--ask', 'C:\\Users\\x\\My Docs']), { ask: 'C:\\Users\\x\\My Docs', hidden: false });
  assert.deepStrictEqual(core.parseArgs(['Exa.exe', '--ask', '"C:\\a b"']).ask, 'C:\\a b');
  assert.deepStrictEqual(core.parseArgs(['Exa.exe']), { ask: null, hidden: false });
  assert.deepStrictEqual(core.parseArgs(['Exa.exe', '--hidden']), { ask: null, hidden: true });
  assert.deepStrictEqual(core.parseArgs(['Exa.exe', '--ask']), { ask: null, hidden: false });
  assert.deepStrictEqual(core.parseArgs(undefined), { ask: null, hidden: false });
});

test('isInside', () => {
  assert.ok(core.isInside(root, root)); assert.ok(core.isInside(root, path.join(root, 'Old', '1.txt')));
  assert.ok(!core.isInside(root, path.join(tmp, 'outside', 'x.txt')));
  assert.ok(!core.isInside(root, path.join(root, '..', 'outside', 'x.txt')));
  assert.ok(!core.isInside(root, root + '-sibling'));          // same prefix, different folder
  assert.ok(!core.isInside(root, path.join(root, '..')));
});

test('listDir: folders first, junk left out, names with spaces and accents kept', () => {
  const v = core.listDir(root, root);
  assert.deepStrictEqual(v.entries.map((e) => e.name), ['Old', 'a b.pdf', 'big.bin', 'é ü.csv', 'empty.txt']);
  assert.ok(v.atRoot && v.parent === null && v.name === 'Docs');
  const sub = core.listDir(root, path.join(root, 'Old'));
  assert.ok(!sub.atRoot && sub.parent === root && sub.entries[0].name === '1.txt');
  assert.match(sub.entries[0].mtime, /^\d{4}-\d\d-\d\d$/);
  assert.throws(() => core.listDir(root, path.join(tmp, 'outside')), /outside/);
  assert.throws(() => core.listDir(root, path.join(root, '..')), /outside/);
});

test('buildBundle: reads the chosen files, checks them again', () => {
  const b = core.buildBundle([path.join(root, 'a b.pdf'), path.join(root, 'é ü.csv'), path.join(root, 'a b.pdf')], root, 'folder', 'Docs');
  assert.strictEqual(b.kind, 'bundle'); assert.strictEqual(b.origin, 'folder'); assert.strictEqual(b.name, 'Docs');
  assert.deepStrictEqual(b.files.map((f) => f.name), ['a b.pdf', 'é ü.csv']);           // the duplicate is dropped
  assert.strictEqual(Buffer.from(b.files[0].b64, 'base64').toString(), 'pdf');
  assert.strictEqual(b.files[0].mime, 'application/pdf'); assert.strictEqual(b.files[1].mime, 'text/csv');
  assert.throws(() => core.buildBundle([path.join(tmp, 'outside', 'x.txt')], root, 'folder'), /outside the folder/);
  assert.throws(() => core.buildBundle([path.join(root, '..', 'outside', 'x.txt')], root, 'folder'), /outside the folder/);
  assert.throws(() => core.buildBundle([path.join(root, 'Old')], root, 'folder'), /not a file/);
  assert.throws(() => core.buildBundle([path.join(root, 'empty.txt')], root, 'folder'), /empty/);
  assert.throws(() => core.buildBundle([path.join(root, 'big.bin')], root, 'folder'), /over 6 MB/);
  assert.throws(() => core.buildBundle([path.join(root, 'nope.txt')], root, 'folder'), /Could not read/);
  assert.throws(() => core.buildBundle([], root, 'folder'), /at least one/);
  assert.throws(() => core.buildBundle([42], root, 'folder'), /outside/);
  assert.throws(() => core.buildBundle(Array.from({ length: 9 }, (_, i) => path.join(root, 'f' + i)), root, 'folder'), /8 files or fewer/);
  assert.strictEqual(core.buildBundle([path.join(root, 'a b.pdf')], root, 'x').origin, 'file');
});

test('buildBundle: 15 MB total', () => {
  const d = path.join(tmp, 'Tight'); for (let i = 0; i < 3; i++) w('Tight/p' + i + '.bin', Buffer.alloc(5 * 1024 * 1024 + 1));
  assert.throws(() => core.buildBundle([0, 1, 2].map((i) => path.join(d, 'p' + i + '.bin')), d, 'folder'), /15 MB together/);
});

test('postHandoff', async () => {
  const ok = async (u, o) => { ok.url = u; ok.body = JSON.parse(o.body); return { status: 200, ok: true, json: async () => ({ id: 'a'.repeat(32) }) }; };
  assert.strictEqual(await core.postHandoff('https://api.example/', { kind: 'bundle' }, ok), 'a'.repeat(32));
  assert.strictEqual(ok.url, 'https://api.example/api/handoff'); assert.strictEqual(ok.body.kind, 'bundle');
  const code = (n, j) => async () => ({ status: n, ok: n < 300, json: async () => j });
  await assert.rejects(core.postHandoff('x', {}, code(429, {})), /a lot in a short time/);
  await assert.rejects(core.postHandoff('x', {}, code(413, {})), /too big/);
  await assert.rejects(core.postHandoff('x', {}, code(200, { id: '../etc' })), /unexpected/);
  await assert.rejects(core.postHandoff('x', {}, code(500, {})), /unexpected/);
  await assert.rejects(core.postHandoff('x', {}, async () => { throw new Error('ECONNREFUSED'); }), /could not reach Exa/);
});

test('handoffUrl', () => assert.strictEqual(core.handoffUrl('https://exa.openwist.com/', 'b'.repeat(32)), 'https://exa.openwist.com/new?handoff=' + 'b'.repeat(32)));
