'use strict';
// Exa for Windows. Stays in the tray. Right-click a folder or file, choose "Ask Exa":
//   file   -> sent straight to Exa
//   folder -> a small window lists what is inside with tick boxes; only the ticked files are sent
// Exa opens in this app's own window, which keeps you signed in.
const path = require('path');
const { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut, ipcMain, shell, dialog } = require('electron');
const core = require('./core');

const API = process.env.EXA_API || core.DEFAULT_API;
const SITE = process.env.EXA_SITE || core.DEFAULT_SITE;
const SITE_ORIGIN = new URL(SITE).origin;
const state = { exa: null, picker: null, root: null, tray: null, quitting: false };

function icon() { return nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')); }

function exaWindow() {
  if (state.exa && !state.exa.isDestroyed()) return state.exa;
  const w = new BrowserWindow({
    width: 1100, height: 780, minWidth: 380, minHeight: 520, show: false, title: 'Exa', icon: icon(), autoHideMenuBar: true,
    backgroundColor: '#262624', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  w.setMenuBarVisibility(false);
  w.once('ready-to-show', () => w.show());
  w.on('close', (e) => { if (!state.quitting) { e.preventDefault(); w.hide(); } });       // closing hides it; Quit is in the tray
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  w.webContents.on('will-navigate', (e, url) => { if (!/^https:/i.test(url) && !url.startsWith(SITE_ORIGIN)) e.preventDefault(); });
  w.loadURL(SITE + '/new');
  state.exa = w;
  return w;
}

function showExa(url) {
  const w = exaWindow();
  if (url) w.loadURL(url);
  if (w.isMinimized()) w.restore();
  w.show(); w.focus();
  return w;
}

function toggleExa() {
  const w = state.exa;
  if (w && !w.isDestroyed() && w.isVisible() && w.isFocused()) w.hide(); else showExa();
}

function problem(msg) { dialog.showMessageBox({ type: 'info', title: 'Ask Exa', message: msg, buttons: ['OK'] }); }

async function sendAndOpen(paths, root, origin, name) {
  const bundle = core.buildBundle(paths, root, origin, name);
  const id = await core.postHandoff(API, bundle);
  showExa(core.handoffUrl(SITE, id));
}

function openPicker(folder) {
  if (state.picker && !state.picker.isDestroyed()) state.picker.destroy();
  state.root = folder;
  const w = new BrowserWindow({
    width: 480, height: 660, minWidth: 360, minHeight: 420, title: 'Ask Exa', icon: icon(), autoHideMenuBar: true,
    alwaysOnTop: true, backgroundColor: '#262624',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  w.setMenuBarVisibility(false);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.on('closed', () => { if (state.picker === w) { state.picker = null; state.root = null; } });
  w.loadFile(path.join(__dirname, '..', 'picker', 'picker.html'));
  state.picker = w;
}

function ask(target) {
  const fs = require('fs');
  let st; try { st = fs.statSync(target); } catch (_) { return problem('Ask Exa could not find that item.'); }
  if (st.isDirectory()) return openPicker(target);
  if (!st.isFile()) return problem('Ask Exa can only take files and folders.');
  const dir = path.dirname(target);
  sendAndOpen([target], dir, 'file', path.basename(target)).catch((e) => problem(e.message));
}

function handle(argv) {
  const a = core.parseArgs(argv);
  if (a.ask) ask(a.ask); else if (!a.hidden) showExa();
}

// The picker may only ask about the folder that was right-clicked, and only from its own window.
function fromPicker(e) { return !!state.picker && !state.picker.isDestroyed() && e.sender === state.picker.webContents && !!state.root; }
function registerIpc() {
  ipcMain.handle('picker:init', (e) => { if (!fromPicker(e)) throw new Error('Not allowed.'); return core.listDir(state.root, state.root); });
  ipcMain.handle('picker:list', (e, dir) => { if (!fromPicker(e)) throw new Error('Not allowed.'); return core.listDir(state.root, String(dir)); });
  ipcMain.handle('picker:send', async (e, paths) => {
    if (!fromPicker(e)) throw new Error('Not allowed.');
    try {
      await sendAndOpen(paths, state.root, 'folder', path.basename(state.root));
      if (state.picker && !state.picker.isDestroyed()) state.picker.close();
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('picker:cancel', (e) => { if (fromPicker(e)) state.picker.close(); });
}

function makeTray() {
  const t = new Tray(icon().resize({ width: 16, height: 16 }));
  t.setToolTip('Exa');
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
  });
}

module.exports = { start, state };
if (process.versions.electron) start();
