'use strict';
// Exa for Windows. Stays in the tray. Right-click a folder or file, choose "Ask Exa":
//   file   -> sent straight to Exa
//   folder -> a small window lists what is inside with tick boxes; only the ticked files are sent
// Exa opens in this app's own window, which keeps you signed in.
const path = require('path');
const { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut, ipcMain, shell, dialog, screen } = require('electron');
const core = require('./core');

const API = process.env.EXA_API || core.DEFAULT_API;
const SITE = process.env.EXA_SITE || core.DEFAULT_SITE;
const SITE_ORIGIN = new URL(SITE).origin;
const state = { exa: null, picker: null, mini: null, root: null, tray: null, quitting: false, sending: false, theme: null };

function icon() { return nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')); }

// Keeps a note of what the Exa window does (page address without the query, errors) and shows a plain page if Exa cannot load.
function where(u) { try { const x = new URL(u); return x.origin + x.pathname; } catch (_) { return '?'; } }
function watch(w, isExa) {
  const c = w.webContents; let errs = 0;
  c.setUserAgent(c.getUserAgent() + ' ExaDesktop/' + app.getVersion());        // the website uses this to know it is inside the app (small answer window)
  c.on('did-finish-load', () => {
    note('page loaded ' + where(c.getURL()));
    if (isExa && c.executeJavaScript) {                                          // so the tick-box window can match the theme you use in Exa
      c.executeJavaScript("(function(){var c=(getComputedStyle(document.body).backgroundColor.match(/\\d+/g)||[38,38,36]);return (+c[0]*299+ +c[1]*587+ +c[2]*114)/1000>140?'light':'dark'})()")
        .then((t) => { if (t === 'light' || t === 'dark') state.theme = t; }).catch(() => {});
    }
  });
  c.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;                                  // -3 = replaced by a newer load, not a failure
    note('page failed ' + code + ' ' + desc + ' ' + where(url));
    w.loadFile(path.join(__dirname, '..', 'picker', 'offline.html'));
  });
  c.on('render-process-gone', (_e, d) => note('page process gone: ' + (d && d.reason)));
  c.on('unresponsive', () => note('page not responding'));
  c.on('console-message', (_e, level, msg, line, src) => { if (level >= 3 && errs++ < 20) note('page error: ' + String(msg).slice(0, 300) + ' (' + where(src) + ':' + line + ')'); });
  c.on('before-input-event', (e, i) => {                                 // Ctrl+R / F5 reload, Ctrl+Shift+I opens the developer tools
    if (i.type !== 'keyDown') return;
    if (i.key === 'F5' || (i.control && i.key.toLowerCase() === 'r')) { e.preventDefault(); c.reloadIgnoringCache(); }
    else if (i.control && i.shift && i.key.toLowerCase() === 'i') { e.preventDefault(); c.toggleDevTools(); }
  });
}

function exaWindow(quiet) {
  if (state.exa && !state.exa.isDestroyed()) return state.exa;
  const w = new BrowserWindow({
    width: 1100, height: 780, minWidth: 380, minHeight: 520, show: false, title: 'Exa Assistant', icon: icon(), autoHideMenuBar: true,
    backgroundColor: '#262624', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  w.setMenuBarVisibility(false);
  w.on('page-title-updated', (e) => e.preventDefault());          // the title bar and taskbar always say Exa Assistant
  w.once('ready-to-show', () => { if (!quiet) w.show(); });
  w.on('close', (e) => { if (!state.quitting) { e.preventDefault(); w.hide(); } });       // closing hides it; Quit is in the tray
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  w.webContents.on('will-navigate', (e, url) => { if (!/^https:/i.test(url) && !url.startsWith(SITE_ORIGIN)) e.preventDefault(); });
  watch(w, true);
  w.loadURL(SITE + '/new').catch(() => {});       // a load that is replaced by a newer one (or fails) is reported by watch()
  state.exa = w;
  return w;
}

function showExa(url) {
  const w = exaWindow();
  if (url) w.loadURL(url).catch(() => {});
  if (w.isMinimized()) w.restore();
  w.show(); w.focus();
  return w;
}

function toggleExa() {
  const w = state.exa;
  if (w && !w.isDestroyed() && w.isVisible() && w.isFocused()) w.hide(); else showExa();
}

// Where small windows appear: the picker next to the pointer (where you just clicked), the answer window in the bottom right corner.
function nearPointer(wd, ht) {
  const p = screen.getCursorScreenPoint(), a = screen.getDisplayNearestPoint(p).workArea;
  return { x: Math.round(Math.min(Math.max(p.x - 40, a.x + 8), a.x + a.width - wd - 8)), y: Math.round(Math.min(Math.max(p.y - 40, a.y + 8), a.y + a.height - ht - 8)) };
}
function bottomRight(wd, ht) {
  const a = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  return { x: a.x + a.width - wd - 16, y: a.y + a.height - ht - 16 };
}
// Clicking anywhere else dismisses a small window, unless it is busy: the answer window keeps going while Exa is working
// (the page puts "working" in its title) and stays until you close it.
function dismissOnBlur(w, busy) {
  w.on('blur', () => setTimeout(() => { if (!w.isDestroyed() && !w.isFocused() && !busy()) w.destroy(); }, 200));
}

function closeMini() { if (state.mini && !state.mini.isDestroyed()) state.mini.destroy(); state.mini = null; }

// The small answer window: Exa's own page in a lean layout (the website switches to it for "&mini=1" inside this app).
// It sends the ticked files by itself and shows the thinking and the answer. "Open in app" continues the same chat in the Exa window.
function openMini(url) {
  closeMini();
  const wd = 440, ht = 640, pos = bottomRight(wd, ht);
  const w = new BrowserWindow({
    width: wd, height: ht, x: pos.x, y: pos.y, show: false, frame: false, transparent: true, resizable: false, maximizable: false, hasShadow: false, alwaysOnTop: true, title: 'Exa', icon: icon(),
    backgroundColor: '#00000000', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  watch(w, false);
  w.once('ready-to-show', () => { w.show(); w.focus(); });
  w.webContents.setWindowOpenHandler(({ url: u }) => {
    if (u.startsWith(SITE_ORIGIN + '/new?open=')) { showExa(u); closeMini(); } else if (/^https?:/i.test(u)) shell.openExternal(u);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, u) => { if (!/^https:/i.test(u) && !u.startsWith(SITE_ORIGIN)) e.preventDefault(); });
  dismissOnBlur(w, () => /working/.test(w.webContents.getTitle()));
  w.on('closed', () => { if (state.mini === w) state.mini = null; });
  w.loadURL(url).catch(() => {});
  state.mini = w;
  return w;
}

function problem(msg) { dialog.showMessageBox({ type: 'info', title: 'Ask Exa', message: msg, buttons: ['OK'] }); }

async function sendAndOpen(paths, root, origin, name) {
  const bundle = core.buildBundle(paths, root, origin, name);
  const id = await core.postHandoff(API, bundle);
  openMini(core.handoffUrl(SITE, id) + '&mini=1');
}

function openPicker(folder) {
  if (state.picker && !state.picker.isDestroyed()) state.picker.destroy();
  state.root = folder;
  const wd = 420, ht = 520, pos = nearPointer(wd, ht);
  const w = new BrowserWindow({
    width: wd, height: ht, x: pos.x, y: pos.y, title: 'Ask Exa', icon: icon(), autoHideMenuBar: true,
    show: false, frame: false, transparent: true, resizable: false, maximizable: false, hasShadow: false, alwaysOnTop: true, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  w.setMenuBarVisibility(false);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.on('closed', () => { if (state.picker === w) { state.picker = null; state.root = null; } });
  w.once('ready-to-show', () => { w.show(); w.focus(); });
  dismissOnBlur(w, () => state.sending);
  w.loadFile(path.join(__dirname, '..', 'picker', 'picker.html'));
  state.picker = w;
}

// A short note kept on this computer only (what Windows handed to the app), so a failure can be diagnosed: %APPDATA%\Exa\last-run.log
function note(text) {
  try { const fs = require('fs'); const f = path.join(app.getPath('userData'), 'last-run.log'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, new Date().toISOString() + '  ' + text + '\n'); } catch (_) {}
}

function ask(target) {
  const fs = require('fs');
  if (/^[A-Za-z]:$/.test(target)) target += '\\';                      // "D:" means the current folder of D; "D:\\" is the drive
  let st; try { st = fs.statSync(target); } catch (err) {
    note('could not open ' + JSON.stringify(target) + ' (' + (err && err.code) + '); app arguments: ' + JSON.stringify(process.argv.slice(1)));
    return problem('Ask Exa could not find that item:\n' + target);
  }
  if (st.isDirectory()) return openPicker(target);
  if (!st.isFile()) return problem('Ask Exa can only take files and folders.');
  const dir = path.dirname(target);
  sendAndOpen([target], dir, 'file', path.basename(target)).catch((e) => problem(e.message));
}

function handle(argv) {
  note('started with ' + JSON.stringify(argv.slice(1)));
  const a = core.parseArgs(argv);
  if (a.ask) ask(a.ask); else if (!a.hidden) showExa();
}

// The picker may only ask about the folder that was right-clicked, and only from its own window.
function fromPicker(e) { return !!state.picker && !state.picker.isDestroyed() && e.sender === state.picker.webContents && !!state.root; }
function registerIpc() {
  ipcMain.handle('picker:init', (e) => { if (!fromPicker(e)) throw new Error('Not allowed.'); return Object.assign(core.listDir(state.root, state.root), { theme: state.theme }); });
  ipcMain.handle('picker:list', (e, dir) => { if (!fromPicker(e)) throw new Error('Not allowed.'); return Object.assign(core.listDir(state.root, String(dir)), { theme: state.theme }); });
  ipcMain.handle('picker:send', async (e, paths) => {
    if (!fromPicker(e)) throw new Error('Not allowed.');
    state.sending = true;
    try {
      await sendAndOpen(paths, state.root, 'folder', path.basename(state.root));
      if (state.picker && !state.picker.isDestroyed()) state.picker.close();
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
    finally { state.sending = false; }
  });
  ipcMain.handle('picker:cancel', (e) => { if (fromPicker(e)) state.picker.close(); });
}

function makeTray() {
  const t = new Tray(icon().resize({ width: 16, height: 16 }));
  t.setToolTip('Exa Assistant');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Open Exa', click: () => showExa() },
    { label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (i) => { app.setLoginItemSettings({ openAtLogin: i.checked, args: ['--hidden'] }); } },
    { type: 'separator' },
    { label: 'Quit Exa', click: () => { state.quitting = true; app.quit(); } },
  ]);
  t.setContextMenu(menu());
  t.on('click', () => showExa());
  state.tray = t;
}

function start() {
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.setAppUserModelId('com.openwist.exa');
  app.on('second-instance', (_e, argv) => handle(argv));
  app.on('window-all-closed', () => {});                       // keeps running in the tray
  app.on('before-quit', () => { state.quitting = true; });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.whenReady().then(() => {
    registerIpc();
    makeTray();
    try { globalShortcut.register('Alt+Space', toggleExa); } catch (_) {}   // if another program owns it, the tray still works
    handle(process.argv);
    // Load Exa quietly in the background (the window stays hidden). The small windows and the main window then open from saved files instead of starting cold.
    setTimeout(() => { try { exaWindow(true); } catch (_) {} }, 1500);
  });
}

module.exports = { start, state };
if (process.versions.electron) start();
