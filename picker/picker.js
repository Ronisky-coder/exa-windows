'use strict';
(function () {
  var $ = function (i) { return document.getElementById(i); };
  var api = window.exaPicker;
  var picked = new Map();         // path -> size, kept while you browse into folders
  var view = null, busy = false, first = true;

  function mb(n) { var v = n / 1048576; return n >= 1048576 ? (v >= 10 || v === Math.floor(v) ? Math.round(v) : v.toFixed(1)) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'; }
  function total() { var t = 0; picked.forEach(function (s) { t += s; }); return t; }
  function why(e) {              // why a file cannot be ticked, or '' when it can
    var L = view.limits;
    if (picked.has(e.path)) return '';
    if (e.size === 0) return 'Empty file';
    if (e.size > L.maxFile) return 'Over ' + mb(L.maxFile);
    if (picked.size >= L.maxFiles) return L.maxFiles + ' files at most';
    if (total() + e.size > L.maxBundle) return 'Over ' + mb(L.maxBundle) + ' in total';
    return '';
  }
  function icon(id) { return '<svg class="ico" width="20" height="20" aria-hidden="true"><use href="#' + id + '"/></svg>'; }
  function say(msg) { var e = $('err'); e.hidden = !msg; e.textContent = msg || ''; }

  function render() {
    var ul = $('list');
    var keep = Array.prototype.indexOf.call(ul.querySelectorAll('.row-i'), document.activeElement);   // keep the keyboard place after a tick
    ul.textContent = '';
    $('where').textContent = view.atRoot ? view.name : view.name;
    $('back').hidden = view.atRoot;
    $('empty').hidden = view.entries.length > 0;
    $('more').hidden = !view.more;
    var files = view.entries.filter(function (e) { return !e.dir; });
    $('all').hidden = files.length < 4;
    view.entries.forEach(function (e) {
      var li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.className = 'row-i';
      if (e.dir) {
        b.innerHTML = icon('i-folder') + '<span class="nm"><b></b><i>Folder</i></span><svg class="nxt" width="16" height="16" aria-hidden="true"><use href="#i-next"/></svg>';
        b.setAttribute('aria-label', 'Open folder ' + e.name);
        b.onclick = function () { open(e.path); };
      } else {
        var no = why(e), on = picked.has(e.path);
        b.setAttribute('role', 'checkbox'); b.setAttribute('aria-checked', on ? 'true' : 'false');
        if (no) b.setAttribute('aria-disabled', 'true');
        b.innerHTML = '<span class="box"><svg aria-hidden="true"><use href="#i-tick"/></svg></span>' + icon('i-file') + '<span class="nm"><b></b><i></i></span>';
        b.querySelector('i').textContent = no ? no : mb(e.size) + '  ·  ' + e.mtime;
        b.onclick = function () { toggle(e); };
      }
      b.querySelector('b').textContent = e.name;
      li.appendChild(b); ul.appendChild(li);
    });
    if (keep >= 0) { var rs = ul.querySelectorAll('.row-i'); if (rs[keep]) rs[keep].focus(); }
    status();
  }
  function status() {
    var L = view.limits, n = picked.size;
    $('count').textContent = n ? n + ' of ' + L.maxFiles + ' chosen  ·  ' + mb(total()) : 'Nothing chosen yet';
    $('go').disabled = !n || busy;
    var files = view.entries.filter(function (e) { return !e.dir; });
    var all = files.length && files.every(function (e) { return picked.has(e.path) || !!why(e); }) && files.some(function (e) { return picked.has(e.path); });
    $('all').textContent = all ? 'Clear this folder' : 'Select all';
  }
  function toggle(e) {
    if (busy) return; say('');
    if (picked.has(e.path)) picked.delete(e.path); else if (!why(e)) picked.set(e.path, e.size);
    render();
  }
  function selectAll() {
    if (busy) return; say('');
    var files = view.entries.filter(function (e) { return !e.dir; });
    var mine = files.filter(function (e) { return picked.has(e.path); });
    var anyLeft = files.some(function (e) { return !picked.has(e.path) && !why(e); });
    if (!anyLeft && mine.length) mine.forEach(function (e) { picked.delete(e.path); });
    else files.forEach(function (e) { if (!picked.has(e.path) && !why(e)) picked.set(e.path, e.size); });
    render();
  }
  function show(v) {
    view = v;
    if (v.theme) document.documentElement.dataset.theme = v.theme;
    if (first) {                                    // a folder with up to 3 files arrives with them ticked, so Enter is all it takes
      first = false;
      var f = v.entries.filter(function (e) { return !e.dir; });
      if (f.length && f.length <= 3 && !v.entries.some(function (e) { return e.dir; })) f.forEach(function (e) { if (!why(e)) picked.set(e.path, e.size); });
    }
    render(); var f = $('list').querySelector('button'); if (f) f.focus(); }
  function open(dir) { say(''); api.list(dir).then(show, function (e) { say(e && e.message ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : 'Could not open that folder.'); }); }

  $('back').onclick = function () { if (view && view.parent) open(view.parent); };
  $('all').onclick = selectAll;
  $('x').onclick = function () { api.cancel(); };
  $('go').onclick = function () {
    if (busy || !picked.size) return;
    busy = true; say(''); $('go').textContent = 'Sending'; $('go').disabled = true;
    api.send(Array.from(picked.keys())).then(function (r) {
      if (r && r.ok) return;                  // the app closes this window
      busy = false; $('go').textContent = 'Ask Exa'; say((r && r.error) || 'Could not send. Try again.'); status();
    }, function () { busy = false; $('go').textContent = 'Ask Exa'; say('Could not send. Try again.'); status(); });
  };
  document.addEventListener('keydown', function (e) {
    var rows = Array.prototype.slice.call($('list').querySelectorAll('.row-i')), at = rows.indexOf(document.activeElement);
    if (e.key === 'Escape') api.cancel();
    else if (e.key === 'Enter' && !$('go').disabled) { e.preventDefault(); $('go').click(); }
    else if (e.key === 'ArrowDown' && rows.length) { e.preventDefault(); rows[Math.min(at + 1, rows.length - 1)].focus(); }
    else if (e.key === 'ArrowUp' && rows.length) { e.preventDefault(); rows[Math.max(at - 1, 0)].focus(); }
    else if (e.key === 'Backspace' && view && view.parent && !busy) open(view.parent);
  });
  api.init().then(show, function () { say('Could not open the folder.'); });
})();
