# Exa for Windows

A small Windows app that lives in the tray and adds **Ask Exa** to the right-click menu.

- Right-click a **file** > Ask Exa: the file goes straight to Exa (up to 6 MB).
- Right-click a **folder** > Ask Exa: a small window lists what is inside with tick boxes. You tick the files Exa should look at (up to 8 files, 6 MB each, 15 MB together) and press Ask Exa. Only the ticked files leave the computer. You can open sub-folders inside the window and keep ticking.
- Exa opens in the app's own window, so you sign in once and stay signed in. **Alt+Space** shows or hides Exa. The tray icon has Open Exa, Start with Windows (off by default) and Quit. Closing the window hides it; Quit is in the tray.
- Exa then says what it sees and asks what you want to do. It cannot change files on your computer.

If something fails, the app keeps a short note of what Windows gave it (paths and error codes, on this computer only) in `%APPDATA%\Exa\last-run.log`: it also records page loads (address without the query) and page errors. In the Exa window, Ctrl+R reloads and Ctrl+Shift+I opens the developer tools. If Exa cannot load, a plain page with Try again appears.

## How it sends things
The app posts the ticked files to `POST /api/handoff` on the Exa backend (5.6.13+), gets back a one-time id, and opens `https://exa.openwist.com/new?handoff=<id>` in its own window. The website claims the id once, attaches the files and writes a first message. The drop lives 15 minutes and is deleted when read. See `DEPLOY.md` in the website package.

## Build the installer (no Windows PC needed)
1. Put this folder in a GitHub repository (for example `openwist/exa-desktop`).
2. Open the repository's **Actions** tab, choose **Build Exa for Windows**, press **Run workflow**.
3. When it finishes, download the artifact **Exa-Setup**. Inside is `Exa-Setup-0.1.3.exe`.
The workflow runs the tests first (`npm test`), then builds a per-user installer (no administrator rights). Installing adds the right-click entries to `HKCU\Software\Classes\Directory\shell\AskExa` and `...\*\shell\AskExa`; uninstalling removes them.

To run it from source on a computer with Node 20: `npm install`, then `npm start` (a folder to test with: `npx electron . --ask "C:\some\folder"`).

## Before wider release
- **Signing.** The installer is unsigned, so Windows SmartScreen shows "Windows protected your PC" (More info, Run anyway). Signing is configured in `package.json` under `build.win` once a certificate or Azure Artifact Signing is chosen.
- **Windows 11** shows the entry under "Show more options". A top-level entry needs a packaged app (MSIX) with a shell extension.
- **Sign-in inside the app.** Use the email code. Google sign-in usually refuses to run inside an app window; GitHub sign-in is not affected. A "sign in with your browser" handshake is the proper fix.
- **Alt+Space** can already be taken by another program; the tray still works then.
- Hidden files: the picker leaves out names starting with `.`, `desktop.ini`, `Thumbs.db` and `~$` temp files, but cannot see the Windows "hidden" attribute.

## Tests
- `npm test`: the file listing, the checks on chosen paths, size limits, the upload, and the main program's behaviour against a stand-in for Electron (right-click on a file, on a folder, the picker's permissions, windows, tray). 16 tests.
- `python3 test/picker_ui.py`: the tick-box window in Chromium (needs Python Playwright), with screenshots in `test/shots`.
