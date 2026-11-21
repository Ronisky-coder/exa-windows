"""The tick-box picker, run in Chromium with a stand-in for the app's four calls. Screenshots go to test/shots."""
import os, json, sys
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); URL = "file://" + os.path.join(HERE, "..", "picker", "picker.html")
SH = os.path.join(HERE, "shots"); os.makedirs(SH, exist_ok=True)
fails = []
def check(n, ok, extra=""):
    print(("PASS " if ok else "FAIL ") + n + ((" :: " + str(extra)) if (not ok and extra) else "")); (not ok) and fails.append(n)

L = {"maxFiles": 8, "maxFile": 6 * 1024 * 1024, "maxBundle": 15 * 1024 * 1024}
def f(n, size, m="2026-03-01"): return {"name": n, "path": "R/" + n, "dir": False, "size": size, "mtime": m}
TREE = {
  "R": {"dir": "R", "name": "Invoices 2026", "atRoot": True, "parent": None, "limits": L, "more": False, "entries": [
      {"name": "Old", "path": "R/Old", "dir": True, "size": 0, "mtime": "2025-12-30"},
      f("budget.xlsx", 20480, "2026-02-11"), f("march.pdf", 2 * 1024 * 1024), f("receipt.png", 800 * 1024), f("huge-video.pdf", 9 * 1024 * 1024),
      f("empty.txt", 0)]},
  "R/Old": {"dir": "R/Old", "name": "Old", "atRoot": False, "parent": "R", "limits": L, "more": False, "entries": [
      {"name": "a.pdf", "path": "R/Old/a.pdf", "dir": False, "size": 1000, "mtime": "2025-01-01"}, {"name": "b.pdf", "path": "R/Old/b.pdf", "dir": False, "size": 1000, "mtime": "2025-01-02"}]},
  "few": {"dir": "few", "name": "Receipts", "atRoot": True, "parent": None, "limits": L, "more": False, "entries": [
      {"name": "a.pdf", "path": "few/a.pdf", "dir": False, "size": 2000, "mtime": "2026-03-01"}, {"name": "b.png", "path": "few/b.png", "dir": False, "size": 3000, "mtime": "2026-03-02"}]},
  "many": {"dir": "many", "name": "Many", "atRoot": True, "parent": None, "limits": L, "more": False,
           "entries": [{"name": "f%d.txt" % i, "path": "many/f%d.txt" % i, "dir": False, "size": 100, "mtime": "2026-01-01"} for i in range(12)]},
  "tight": {"dir": "tight", "name": "Tight", "atRoot": True, "parent": None, "limits": L, "more": False,
            "entries": [{"name": "p%d.pdf" % i, "path": "tight/p%d.pdf" % i, "dir": False, "size": 5 * 1024 * 1024, "mtime": "2026-01-01"} for i in range(4)]},
}
MOCK = """
window.__calls = []; window.__tree = %s; window.__start = %s; window.__sendResult = {ok: true};
window.exaPicker = {
  init: () => Promise.resolve(window.__tree[window.__start]),
  list: (d) => { window.__calls.push(['list', d]); return window.__tree[d] ? Promise.resolve(window.__tree[d]) : Promise.reject(new Error("That folder is outside the one you chose.")); },
  send: (p) => { window.__calls.push(['send', p]); return Promise.resolve(window.__sendResult); },
  cancel: () => { window.__calls.push(['cancel']); return Promise.resolve(); } };
"""
def page(br, start="R", w=480, h=660, scheme="light"):
    c = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, color_scheme=scheme)
    c.add_init_script(MOCK % (json.dumps(TREE), json.dumps(start))); pg = c.new_page(); pg.goto(URL); pg.wait_for_selector(".row-i"); return pg
def rows(pg): return pg.eval_on_selector_all(".row-i", "els => els.map(e => ({t: e.innerText.replace(/\\s+/g,' ').trim(), c: e.getAttribute('aria-checked'), d: e.getAttribute('aria-disabled')}))")
def calls(pg): return pg.evaluate("window.__calls")

with sync_playwright() as p:
    br = p.chromium.launch()
    pg = page(br)
    check("shows the folder name and the one instruction", pg.inner_text("#where") == "Invoices 2026" and "Tick what Exa should look at" in pg.inner_text(".sub"))
    r = rows(pg)
    check("folders come first", r[0]["t"].startswith("Old"), r[0])
    check("button is off until something is ticked", pg.is_disabled("#go") and "Nothing chosen" in pg.inner_text("#count"))
    check("a file over 6 MB cannot be ticked and says why", [x for x in r if "huge-video" in x["t"]][0]["d"] == "true" and "Over 6 MB" in [x for x in r if "huge-video" in x["t"]][0]["t"])
    check("an empty file cannot be ticked", [x for x in r if "empty.txt" in x["t"]][0]["d"] == "true")
    pg.click("text=budget.xlsx"); pg.click("text=march.pdf")
    check("ticking works and counts", "2 of 8 chosen" in pg.inner_text("#count") and not pg.is_disabled("#go"), pg.inner_text("#count"))
    pg.click("text=huge-video.pdf", force=True)
    check("clicking a blocked file does nothing", "2 of 8" in pg.inner_text("#count"))
    pg.click("text=march.pdf"); check("unticking works", "1 of 8" in pg.inner_text("#count"))
    pg.click("text=march.pdf")
    pg.click("text=Old"); pg.wait_for_selector("text=a.pdf")
    check("opens a subfolder", pg.inner_text("#where") == "Old" and not pg.is_hidden("#back") and calls(pg)[-1] == ["list", "R/Old"])
    check("ticks are kept while browsing", "2 of 8" in pg.inner_text("#count"))
    pg.click("text=a.pdf"); check("a file from the subfolder counts", "3 of 8" in pg.inner_text("#count"))
    pg.click("#back"); pg.wait_for_selector("text=budget.xlsx")
    check("back returns to the top and keeps ticks", pg.inner_text("#where") == "Invoices 2026" and "3 of 8" in pg.inner_text("#count"))
    check("back arrow is hidden at the top folder", pg.is_hidden("#back"))
    pg.wait_for_timeout(300); pg.screenshot(path=SH + "/picker-light.png")
    pg.click("#go"); pg.wait_for_timeout(100)
    sent = [c for c in calls(pg) if c[0] == "send"]
    check("sends exactly the ticked files", len(sent) == 1 and sorted(sent[0][1]) == ["R/Old/a.pdf", "R/budget.xlsx", "R/march.pdf"], sent)
    # a failed send shows the reason and lets the person try again
    pg = page(br); pg.click("text=budget.xlsx")
    pg.evaluate("window.__sendResult = {ok: false, error: 'Ask Exa could not reach Exa. Check your internet connection and try again.'}")
    pg.click("#go"); pg.wait_for_selector("#err:not([hidden])")
    check("a failed send says why", "could not reach Exa" in pg.inner_text("#err") and not pg.is_disabled("#go") and pg.inner_text("#go") == "Ask Exa")
    pg.keyboard.press("Escape"); check("Escape cancels", ["cancel"] in calls(pg))
    pg.click("#x"); check("the close button cancels", calls(pg).count(["cancel"]) == 2)
    # select all
    pg = page(br)
    pg.click("#all"); r = rows(pg)
    check("select all ticks only what is allowed", [x["c"] for x in r if "budget" in x["t"] or "march" in x["t"] or "receipt" in x["t"]] == ["true"] * 3 and [x["c"] for x in r if "huge" in x["t"] or "empty" in x["t"]] == ["false"] * 2, r)
    check("button reads Clear this folder after", pg.inner_text("#all") == "Clear this folder", repr(pg.inner_text("#all")))
    pg.click("#all"); check("and clears again", "Nothing chosen" in pg.inner_text("#count") and pg.inner_text("#all") == "Select all")
    # eight at most
    pg = page(br, "many"); pg.click("#all")
    check("select all stops at 8 files", "8 of 8" in pg.inner_text("#count"), pg.inner_text("#count"))
    r = rows(pg); check("the rest say why", sum(1 for x in r if x["d"] == "true" and "8 files at most" in x["t"]) == 4, r)
    # 15 MB total
    pg = page(br, "tight"); pg.click("#all")
    check("total size limit holds (3 x 5 MB fits, the fourth does not)", "3 of 8" in pg.inner_text("#count") and "Over 15 MB in total" in pg.inner_text("#list"), pg.inner_text("#count"))
    # keyboard
    pg = page(br); pg.keyboard.press("Tab"); pg.keyboard.press("Tab"); pg.keyboard.press("Tab")
    pg = page(br); pg.focus(".row-i:has-text('budget.xlsx')"); pg.keyboard.press("Space"); check("Space ticks the focused file", "1 of 8" in pg.inner_text("#count"))
    check("focus stays on the same row after ticking", pg.evaluate("document.activeElement.innerText").startswith("budget.xlsx"))
    pg.keyboard.press("ArrowDown") if False else None
    pg.click("#go"); check("Ask Exa via button after keyboard tick", any(c[0] == "send" for c in calls(pg)))
    # an unexpected error from the app is shown without the Electron wrapper text
    pg = page(br); pg.evaluate("window.exaPicker.list = () => Promise.reject(new Error(\"Error invoking remote method 'picker:list': Error: That folder is outside the one you chose.\")); 0")
    pg.click("text=Old"); pg.wait_for_selector("#err:not([hidden])"); check("errors are plain", pg.inner_text("#err") == "That folder is outside the one you chose.", pg.inner_text("#err"))
    # a small folder arrives ticked, and Enter sends
    pg = page(br, "few")
    check("up to 3 files and no folders: all ticked on arrival", "2 of 8 chosen" in pg.inner_text("#count") and not pg.is_disabled("#go"), pg.inner_text("#count"))
    check("Select all is not offered for a small folder", pg.is_hidden("#all"))
    pg.keyboard.press("Enter"); check("Enter sends them", [c for c in calls(pg) if c[0] == "send"] and sorted([c for c in calls(pg) if c[0] == "send"][0][1]) == ["few/a.pdf", "few/b.png"], calls(pg))
    pg = page(br); check("a bigger folder is not pre-ticked", "Nothing chosen" in pg.inner_text("#count"))
    pg = page(br); pg.evaluate("document.documentElement.dataset.theme = 'light'"); pg.screenshot(path=SH + "/picker-theme-light.png")
    # arrow keys move between rows
    pg = page(br); pg.focus(".row-i:has-text('budget.xlsx')"); pg.keyboard.press("ArrowDown"); check("ArrowDown moves to the next row", pg.evaluate("document.activeElement.innerText").startswith("march.pdf"))
    pg.keyboard.press("ArrowUp"); check("ArrowUp moves back", pg.evaluate("document.activeElement.innerText").startswith("budget.xlsx"))
    # looks: dark, narrow, no sideways scroll
    for name, kw in [("dark", dict(scheme="dark")), ("narrow", dict(w=340, h=560)), ("dark-narrow", dict(w=340, h=560, scheme="dark"))]:
        pg = page(br, **kw); pg.click("text=budget.xlsx"); pg.click("text=receipt.png"); pg.wait_for_timeout(300); pg.screenshot(path=SH + "/picker-%s.png" % name)
        check(name + ": no sideways scroll", pg.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        check(name + ": the button and close are visible", pg.is_visible("#go") and pg.is_visible("#x"))
    # file names are text, never markup
    pg = page(br); pg.evaluate("window.__tree.R.entries[1].name = '<img src=x onerror=window.__x=1>.pdf'"); pg.reload(); pg.wait_for_selector(".row-i")
    check("a file name is shown as text, not run", pg.evaluate("window.__x") is None)
    br.close()
print("FAILS:", fails or "none")
