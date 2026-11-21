# Exa for Windows

A small Windows app that lives in the tray and adds **Ask Exa** to the right-click menu.

- Right-click a **file** > Ask Exa: the file is sent at once (up to 6 MB).
- Right-click a **folder** > Ask Exa: a small picker opens next to the pointer and lists what is inside with tick boxes. A small folder (up to 3 files, no sub-folders) arrives ticked, so Enter is all it takes. Otherwise tick what Exa should look at (up to 8 files, 6 MB each, 15 MB together), open sub-folders if needed, and press Ask Exa. Only the ticked files leave the computer.
- Then the picker closes and a **small answer window** opens in the bottom right corner. It sends the files by itself and shows only Exa's thinking and answer. **Open in app** continues the same chat in the main Exa window with your files and everything preserved. You can ask a follow-up in the small window. Dismiss it with Esc, the X, or by clicking anywhere else (it stays open while Exa is still working).
- The main Exa window keeps you signed in. **Alt+Space** shows or hides it. The tray icon has Open Exa, Start with Windows (off by default) and Quit. Closing the window hides it; Quit is in the tray.
- Exa cannot change files on your computer.

## How it sends things
The app posts the ticked files to `POST /api/handoff` on the Exa backend (5.6.13+), gets back a one-time id, and opens `https://exa.openwist.com/new?handoff=<id>&mini=1` in the small window. The website claims the id once, attaches the files, writes the first message and sends it. The drop lives 15 minutes and is deleted when read. See `DEPLOY.md` in the website package.

## Build the installer (no Windows PC needed) and publish it
1. Put this folder in a GitHub repository (for example `openwist/exa-desktop`).
2. **Test build:** Actions tab, **Build Exa for Windows**, **Run workflow**. Download the artifact **Exa-Setup** (it holds `Exa-Setup.exe`).
3. **Public release:** push a tag, for example `git tag v0.3.0 && git push origin v0.3.0`. The same workflow then attaches `Exa-Setup.exe` to a GitHub Release. The file always has the same name, so this link always gives the newest installer:
   `https://github.com/<owner>/<repo>/releases/latest/download/Exa-Setup.exe` (the repository must be public for visitors to download it).
4. Paste that link in the Exa admin panel, Messages, **Exa for Windows download**, with the version. Exa then shows the Install Exa for Windows prompt (top right) and the last sign-up step to people on Windows computers.
The workflow runs the tests first (`npm test`), then builds a per-user installer (no administrator rights). Installing adds the right-click entries to `HKCU\Software\Classes\Directory\shell\AskExa` and `...\*\shell\AskExa`; uninstalling removes them.

To run it from source on a computer with Node 20: `npm install`, then `npm start` (a folder to test with: `npx electron . --ask "C:\some\folder"`).

## Before wider release
- **Signing (the "Unknown publisher" warning).** The app already says Openwist Ltd everywhere (company, copyright, `publisherName`), but Windows only shows a publisher name when the installer carries a code-signing certificate issued to Openwist Ltd. Until then it says "Unknown publisher" and SmartScreen may say "Windows protected your PC". Options: (1) a code-signing certificate from a certificate authority, after they verify Openwist Ltd. Certificates issued since 2023 are normally kept on a hardware token or in the CA's cloud signing service, so a .pfx file may not be available; check with the CA before you buy. (2) Microsoft's Azure Artifact Signing (formerly Trusted Signing), if your country and company are eligible. (3) Publishing in the Microsoft Store, which signs the app for you. With a .pfx, add the repository secrets `CSC_LINK` and `CSC_KEY_PASSWORD` and the workflow signs automatically and reports the result. A new certificate may still show a SmartScreen notice for a while until the installer gains reputation.
- **Window look.** The picker and the small answer window are transparent with a rounded card and a soft shadow, and are a fixed size. If a very old graphics driver shows a black box around them, tell us and we will switch them to a plain window.
- **Windows 11** shows the entry under "Show more options". A top-level entry needs a packaged app (MSIX) with a shell extension.
- **Sign-in inside the app.** Use the email code. Google sign-in usually refuses to run inside an app window; GitHub sign-in is not affected. A "sign in with your browser" handshake is the proper fix.
- **Alt+Space** can already be taken by another program; the tray still works then.
- Hidden files: the picker leaves out names starting with `.`, `desktop.ini`, `Thumbs.db` and `~$` temp files, but cannot see the Windows "hidden" attribute.

## Tests
- `npm test`: the file listing, the checks on chosen paths, size limits, the upload, and the main program's behaviour against a stand-in for Electron (right-click on a file, on a folder, the picker's permissions, windows, tray). 19 tests.
- `python3 test/picker_ui.py`: the tick-box window in Chromium (needs Python Playwright), with screenshots in `test/shots`.
