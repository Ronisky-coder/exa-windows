'use strict';
// Runs src/main.js against a stand-in for Electron, to check what it does with right-clicks, the picker's calls and the window rules.
// (It cannot show real windows; that needs Windows. See README.)
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), Module = require('module');

const tmp2 = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'exa-ud-'));
const log = { wins: [], handlers: {}, shortcuts: {}, openExternal: [], boxes: [], lock: true, login: null, quit: false, once: {}, appOn: {} };
class Win {
  constructor(o) { this.o = o; this.loaded = []; this.ev = {}; this.shown = false; this.destroyed = false; this.focused = false;
    this.webContents = { setWindowOpenHandler: (f) => { this.openHandler = f; }, on: (n, f) => { this.nav = f; } }; log.wins.push(this); }
  setMenuBarVisibility() {} once(n, f) { this.once_ = f; } on(n, f) { this.ev[n] = f; }
  loadURL(u) { this.loaded.push(u); } loadFile(f) { this.file = f; }
  show() { this.shown = true; } hide() { this.shown = false; } focus() { this.focused = true; } isMinimized() { return false; } restore() {}
  isVisible() { return this.shown; } isFocused() { return this.focused; } isDestroyed() { return this.destroyed; }
  close() { this.destroyed = true; this.ev.closed && this.ev.closed(); } destroy() { this.close(); }
}
const electron = {
  app: { requestSingleInstanceLock: () => log.lock, quit: () => { log.quit = true; }, setAppUserModelId() {}, on: (n, f) => { log.appOn[n] = f; },
         whenReady: () => Promise.resolve(), getPath: () => tmp2, getLoginItemSettings: () => ({ openAtLogin: false }), setLoginItemSettings: (o) => { log.login = o; } },
  BrowserWindow: Win, Tray: class { constructor() { this.m = null; } setToolTip() {} setContextMenu(m) { this.m = m; } on() {} },
  Menu: { buildFromTemplate: (t) => t }, nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
  globalShortcut: { register: (k, f) => { log.shortcuts[k] = f; }, unregisterAll() {} },
  ipcMain: { handle: (n, f) => { log.handlers[n] = f; } }, shell: { openExternal: (u) => log.openExternal.push(u) },
  dialog: { showMessageBox: (o) => { log.boxes.push(o.message); return Promise.resolve(); } },
};
const orig = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? electron : orig.call(this, r, ...a); };
process.env.EXA_API = 'https://api.test'; process.env.EXA_SITE = 'https://site.test';
const sent = []; global.fetch = async (u, o) => { sent.push({ u, body: JSON.parse(o.body) }); return { status: 200, ok: true, json: async () => ({ id: 'c'.repeat(32) }) }; };
const { start, state } = require('../src/main');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exa-m-'));
const dir = path.join(tmp, 'Docs'); fs.mkdirSync(path.join(dir, 'Sub'), { recursive: true });
fs.writeFileSync(path.join(dir, 'a.txt'), 'aaa'); fs.writeFileSync(path.join(dir, 'Sub', 'b.txt'), 'bbb'); fs.writeFileSync(path.join(tmp, 'out.txt'), 'zzz');
const settle = () => new Promise((r) => setTimeout(r, 30));
const exa = () => log.wins.filter((w) => w.o.title === 'Exa').pop();
const picker = () => log.wins.filter((w) => w.o.title === 'Ask Exa').pop();
let argv0 = ['Exa.exe'];

test('a normal start opens Exa; --hidden does not', async () => {
  process.argv = argv0; start(); await settle();
  const w = exa(); assert.deepStrictEqual(w.loaded, ['https://site.test/new']);
  w.once_(); assert.ok(w.shown);
  assert.ok(log.shortcuts['Alt+Space'], 'Alt+Space registered');
  assert.deepStrictEqual(Object.keys(log.handlers).sort(), ['picker:cancel', 'picker:init', 'picker:list', 'picker:send']);
  const n = log.wins.length; log.appOn['second-instance']({}, ['Exa.exe', '--hidden']); assert.strictEqual(log.wins.length, n);
});

test('window rules: the Exa window has no Node, closing hides it, links open outside', () => {
  const w = exa();
  assert.deepStrictEqual([w.o.webPreferences.nodeIntegration, w.o.webPreferences.contextIsolation, w.o.webPreferences.sandbox], [false, true, true]);
  let prevented = false; w.ev.close({ preventDefault: () => { prevented = true; } }); assert.ok(prevented && !w.shown);
  assert.deepStrictEqual(w.openHandler({ url: 'https://example.com/x' }), { action: 'deny' }); assert.deepStrictEqual(log.openExternal, ['https://example.com/x']);
  w.openHandler({ url: 'file:///C:/Windows/system32/calc.exe' }); assert.strictEqual(log.openExternal.length, 1);   // never opens a file: link
  let p = false; w.nav({ preventDefault: () => { p = true; } }, 'file:///etc/passwd'); assert.ok(p);
  p = false; w.nav({ preventDefault: () => { p = true; } }, 'https://accounts.google.com/o/oauth2'); assert.ok(!p);
});

test('the Alt+Space shortcut shows Exa, then hides it when focused', () => {
  const w = exa(); w.shown = false; log.shortcuts['Alt+Space'](); assert.ok(w.shown && w.focused);
  log.shortcuts['Alt+Space'](); assert.ok(!w.shown);
});

test('right-click on a FILE sends it straight to Exa', async () => {
  sent.length = 0; log.appOn['second-instance']({}, ['Exa.exe', '--ask', path.join(dir, 'a.txt')]); await settle();
  assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0].u, 'https://api.test/api/handoff');
  assert.strictEqual(sent[0].body.origin, 'file'); assert.deepStrictEqual(sent[0].body.files.map((f) => f.name), ['a.txt']);
  assert.deepStrictEqual(exa().loaded.pop(), 'https://site.test/new?handoff=' + 'c'.repeat(32));
});

test('right-click on a FOLDER opens the picker, which can only see that folder', async () => {
  sent.length = 0; log.appOn['second-instance']({}, ['Exa.exe', '--ask', dir]); await settle();
  const pk = picker(); assert.ok(pk && pk.file.endsWith('picker.html')); assert.strictEqual(sent.length, 0, 'nothing is sent before you choose');
  assert.strictEqual(pk.o.webPreferences.nodeIntegration, false); assert.ok(pk.o.webPreferences.preload.endsWith('preload.js'));
  const ev = { sender: pk.webContents }, stranger = { sender: {} };
  const v = await log.handlers['picker:init'](ev); assert.deepStrictEqual(v.entries.map((e) => e.name), ['Sub', 'a.txt']);
  await assert.rejects(async () => log.handlers['picker:init'](stranger), /Not allowed/);
  await assert.rejects(async () => log.handlers['picker:send'](stranger, [path.join(dir, 'a.txt')]), /Not allowed/);
  assert.strictEqual((await log.handlers['picker:list'](ev, path.join(dir, 'Sub'))).entries[0].name, 'b.txt');
  await assert.rejects(async () => log.handlers['picker:list'](ev, tmp), /outside/);
  // sending something outside the folder fails and sends nothing
  const bad = await log.handlers['picker:send'](ev, [path.join(tmp, 'out.txt')]); assert.strictEqual(bad.ok, false); assert.match(bad.error, /outside the folder/); assert.strictEqual(sent.length, 0);
  // sending ticked files
  const ok = await log.handlers['picker:send'](ev, [path.join(dir, 'a.txt'), path.join(dir, 'Sub', 'b.txt')]); assert.deepStrictEqual(ok, { ok: true });
  assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0].body.origin, 'folder'); assert.strictEqual(sent[0].body.name, 'Docs');
  assert.deepStrictEqual(sent[0].body.files.map((f) => f.name), ['a.txt', 'b.txt']);
  assert.ok(pk.destroyed, 'the picker closes'); assert.ok(exa().loaded.pop().includes('handoff=' + 'c'.repeat(32)));
});

test('a failed upload comes back to the picker as a message and the picker stays open', async () => {
  global.fetch = async () => { throw new Error('offline'); };
  log.appOn['second-instance']({}, ['Exa.exe', '--ask', dir]); await settle();
  const r = await log.handlers['picker:send']({ sender: picker().webContents }, [path.join(dir, 'a.txt')]);
  assert.strictEqual(r.ok, false); assert.match(r.error, /could not reach Exa/); assert.ok(!picker().destroyed);
});

test('missing item and a file failure show a message box', async () => {
  log.appOn['second-instance']({}, ['Exa.exe', '--ask', path.join(tmp, 'gone')]); await settle(); assert.match(log.boxes.pop(), /could not find that item:\n.*gone/); assert.match(fs.readFileSync(path.join(tmp2, 'last-run.log'), 'utf8'), /could not open .*gone.*ENOENT/);
  log.appOn['second-instance']({}, ['Exa.exe', '--ask', path.join(dir, 'a.txt')]); await settle(); assert.match(log.boxes.pop(), /could not reach Exa/);
});

test('tray: start with Windows toggle and Quit', () => {
  const m = state.tray.m; const t = m.find((i) => i.type === 'checkbox'); t.click({ checked: true });
  assert.deepStrictEqual(log.login, { openAtLogin: true, args: ['--hidden'] });
  m.find((i) => i.label === 'Quit Exa').click(); assert.ok(log.quit && state.quitting);
});

test('a second copy of the app quits at once', () => {
  log.lock = false; log.quit = false; start(); assert.ok(log.quit);
});
