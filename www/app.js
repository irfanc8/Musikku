/* Musikku v1.0 — pemutar musik online (Internet Archive) + offline (unduhan & file lokal) */
(function () {
  'use strict';

  /* ---------- util ---------- */
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  function fmtTime(sec) {
    if (!isFinite(sec) || sec == null) return '0:00';
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }
  function parseLength(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    const str = String(v).trim();
    if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str);
    const parts = str.split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function trackKey(t) { return t.id; }

  /* ---------- storage: localStorage ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  let favs = store.get('musikku_favs', []);
  let recent = store.get('musikku_recent', []);

  /* ---------- IndexedDB (metadata unduhan + blob file impor) ---------- */
  const DB_NAME = 'musikku-db', DB_VER = 1;
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('downloads')) d.createObjectStore('downloads', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  function idbTx(storeName, mode, fn) {
    return db().then((d) => new Promise((resolve, reject) => {
      const tx = d.transaction(storeName, mode);
      const st = tx.objectStore(storeName);
      const out = fn(st);
      tx.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      tx.onerror = () => reject(tx.error);
    }));
  }
  function idbPut(storeName, val) { return idbTx(storeName, 'readwrite', (st) => st.put(val)); }
  function idbGet(storeName, key) { return db().then((d) => new Promise((res, rej) => { const r = d.transaction(storeName).objectStore(storeName).get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })); }
  function idbAll(storeName) { return db().then((d) => new Promise((res, rej) => { const r = d.transaction(storeName).objectStore(storeName).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); })); }
  function idbDel(storeName, key) { return idbTx(storeName, 'readwrite', (st) => st.delete(key)); }

  /* ---------- audio / player state ---------- */
  const audio = $('#audio');
  let queue = [];      // array of track objects
  let qi = -1;         // index in queue
  let shuffle = false;
  let repeatMode = 0;  // 0 off, 1 all, 2 one
  let downloadedIds = new Set();

  function currentTrack() { return (qi >= 0 && qi < queue.length) ? queue[qi] : null; }

  function setStatus(msg) { const el = $('#statusLine'); if (el) el.textContent = msg; }

  /* ---------- Internet Archive API ---------- */
  const ARC = 'https://archive.org';
  function archiveSearch(query, rows) {
    const q = 'mediatype:audio AND (' + query + ')';
    const url = ARC + '/advancedsearch.php?' + new URLSearchParams({
      q: q, 'fl[]': ['identifier', 'title', 'creator'], rows: String(rows || 10), output: 'json'
    }).toString();
    return fetch(url).then((r) => r.json()).then((d) => (d.response && d.response.docs) || []);
  }
  function archiveItemTracks(identifier) {
    return fetch(ARC + '/metadata/' + encodeURIComponent(identifier))
      .then((r) => r.json())
      .then((d) => {
        const md = d.metadata || {};
        const title = (Array.isArray(md.title) ? md.title[0] : md.title) || identifier;
        const creator = (Array.isArray(md.creator) ? md.creator[0] : md.creator) || (Array.isArray(md.artist) ? md.artist[0] : md.artist) || 'Internet Archive';
        const files = (d.files || []).filter((f) => {
          const name = (f.name || '').toLowerCase();
          const fmt = (f.format || '').toLowerCase();
          if (!(name.endsWith('.mp3') || name.endsWith('.ogg') || name.endsWith('.m4a'))) return false;
          if (fmt.indexOf('mp3') === -1 && fmt.indexOf('ogg') === -1 && fmt.indexOf('m4a') === -1 && fmt.indexOf('vorbis') === -1) return false;
          if (name.indexOf('sample') !== -1) return false;
          return true;
        });
        return files.map((f) => ({
          id: 'arc:' + identifier + ':' + f.name,
          title: cleanTrackTitle(f.title || f.name, title),
          artist: creator,
          album: title,
          url: ARC + '/download/' + encodeURIComponent(identifier) + '/' + encodeURIComponent(f.name),
          duration: parseLength(f.length),
          source: 'archive',
          identifier: identifier,
          filename: f.name
        }));
      });
  }
  function cleanTrackTitle(fileTitle, albumTitle) {
    let t = String(fileTitle || '').replace(/\.(mp3|ogg|m4a)$/i, '').replace(/[_+]/g, ' ').trim();
    if (!t || t === albumTitle) return albumTitle;
    return t;
  }
  function searchTracks(query, rows) {
    return archiveSearch(query, rows || 8).then((docs) => {
      if (!docs.length) return [];
      return Promise.all(docs.map((doc) => archiveItemTracks(doc.identifier).catch(() => [])))
        .then((lists) => lists.flat());
    });
  }

  /* ---------- playback ---------- */
  function playAt(list, index) {
    if (!list || !list.length) return;
    queue = list.slice();
    qi = index;
    loadCurrent(true);
  }
  function loadCurrent(autoplay) {
    const t = currentTrack();
    if (!t) return;
    const bar = $('#playerBar');
    bar.classList.remove('hidden');
    $('#nowTitle').textContent = t.title;
    $('#nowArtist').textContent = t.artist + (t.album ? ' — ' + t.album : '');
    updateFavBtn();
    updateDlBtn();
    updateQueueLine();
    markPlayingRow();
    if (t.source === 'import' && t._blob) {
      if (audio._objUrl) URL.revokeObjectURL(audio._objUrl);
      audio._objUrl = URL.createObjectURL(t._blob);
      audio.src = audio._objUrl;
    } else {
      audio.src = t.url;
    }
    if (autoplay) audio.play().catch(() => {});
    pushRecent(t);
  }
  function togglePlay() {
    if (!currentTrack()) return;
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  }
  function nextTrack() {
    if (!queue.length) return;
    if (repeatMode === 2) { audio.currentTime = 0; audio.play().catch(() => {}); return; }
    if (shuffle) {
      let n = qi;
      if (queue.length > 1) { while (n === qi) n = Math.floor(Math.random() * queue.length); }
      qi = n;
    } else {
      qi = qi + 1;
      if (qi >= queue.length) {
        if (repeatMode === 1) qi = 0; else { qi = queue.length - 1; audio.pause(); return; }
      }
    }
    loadCurrent(true);
  }
  function prevTrack() {
    if (!queue.length) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    qi = (qi - 1 + queue.length) % queue.length;
    loadCurrent(true);
  }
  audio.addEventListener('ended', () => { if (repeatMode === 2) { audio.currentTime = 0; audio.play().catch(() => {}); } else nextTrack(); });
  audio.addEventListener('play', () => { $('#playBtn').textContent = '⏸'; markPlayingRow(); });
  audio.addEventListener('pause', () => { $('#playBtn').textContent = '▶'; markPlayingRow(); });
  audio.addEventListener('timeupdate', () => {
    const d = audio.duration || 0;
    $('#curTime').textContent = fmtTime(audio.currentTime);
    $('#durTime').textContent = fmtTime(d);
    if (d > 0) $('#seekBar').value = String((audio.currentTime / d) * 100);
  });
  audio.addEventListener('loadedmetadata', () => { $('#durTime').textContent = fmtTime(audio.duration || 0); });
  $('#seekBar').addEventListener('input', (e) => {
    const d = audio.duration || 0;
    if (d > 0) audio.currentTime = (parseFloat(e.target.value) / 100) * d;
  });
  $('#volBar').addEventListener('input', (e) => { audio.volume = parseFloat(e.target.value); });
  $('#playBtn').addEventListener('click', togglePlay);
  $('#nextBtn').addEventListener('click', nextTrack);
  $('#prevBtn').addEventListener('click', prevTrack);
  $('#shuffleBtn').addEventListener('click', (e) => { shuffle = !shuffle; e.currentTarget.classList.toggle('on', shuffle); });
  $('#repeatBtn').addEventListener('click', (e) => {
    repeatMode = (repeatMode + 1) % 3;
    e.currentTarget.classList.toggle('on', repeatMode > 0);
    e.currentTarget.textContent = repeatMode === 2 ? '🔂' : '🔁';
  });

  /* ---------- favorites / recent ---------- */
  function isFav(id) { return favs.some((f) => f.id === id); }
  function toggleFav() {
    const t = currentTrack();
    if (!t) return;
    const i = favs.findIndex((f) => f.id === t.id);
    if (i >= 0) favs.splice(i, 1); else favs.unshift({ id: t.id, title: t.title, artist: t.artist, album: t.album || '', url: t.url, duration: t.duration || 0, source: t.source, identifier: t.identifier || '', filename: t.filename || '' });
    store.set('musikku_favs', favs);
    updateFavBtn();
    renderFavs();
  }
  function updateFavBtn() {
    const t = currentTrack();
    const b = $('#favBtn');
    if (!t) { b.textContent = '♡'; b.classList.remove('faved'); return; }
    const f = isFav(t.id);
    b.textContent = f ? '♥' : '♡';
    b.classList.toggle('faved', f);
  }
  $('#favBtn').addEventListener('click', toggleFav);
  function pushRecent(t) {
    recent = recent.filter((r) => r.id !== t.id);
    recent.unshift({ id: t.id, title: t.title, artist: t.artist, album: t.album || '', url: t.url, duration: t.duration || 0, source: t.source, identifier: t.identifier || '', filename: t.filename || '' });
    if (recent.length > 20) recent.length = 20;
    store.set('musikku_recent', recent);
  }

  /* ---------- downloads (Cache API + IndexedDB metadata) ---------- */
  const AUDIO_CACHE = 'musikku-audio-v1';
  function refreshDownloadedIds() {
    return idbAll('downloads').then((rows) => { downloadedIds = new Set(rows.map((r) => r.id)); $('#dlCount').textContent = String(rows.length); return rows; }).catch(() => []);
  }
  function downloadCurrent() {
    const t = currentTrack();
    if (!t || t.source !== 'archive') return;
    const btn = $('#dlBtn'), st = $('#dlState');
    btn.disabled = true; st.textContent = 'Mengunduh…';
    fetch(t.url).then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return caches.open(AUDIO_CACHE).then((c) => c.put(t.url, res));
    }).then(() => idbPut('downloads', {
      id: t.id, title: t.title, artist: t.artist, album: t.album || '', url: t.url,
      duration: t.duration || 0, identifier: t.identifier, filename: t.filename, downloadedAt: Date.now()
    })).then(() => {
      st.textContent = '✓ Tersimpan offline';
      btn.disabled = false;
      return refreshDownloadedIds();
    }).then(() => { updateDlBtn(); renderDownloads(); })
      .catch((err) => { st.textContent = 'Gagal mengunduh'; btn.disabled = false; });
  }
  $('#dlBtn').addEventListener('click', downloadCurrent);
  function updateDlBtn() {
    const t = currentTrack();
    const btn = $('#dlBtn'), st = $('#dlState');
    if (!t || t.source !== 'archive') { btn.style.display = 'none'; st.textContent = ''; return; }
    btn.style.display = '';
    if (downloadedIds.has(t.id)) { btn.disabled = true; btn.textContent = '✓ Diunduh'; st.textContent = 'Tersedia offline'; }
    else { btn.disabled = false; btn.textContent = '⬇ Unduh'; st.textContent = ''; }
  }
  function removeDownload(id, url) {
    caches.open(AUDIO_CACHE).then((c) => c.delete(url)).catch(() => {});
    return idbDel('downloads', id).then(() => refreshDownloadedIds()).then(() => { updateDlBtn(); renderDownloads(); });
  }
  function renderDownloads() {
    const box = $('#downloadsList');
    idbAll('downloads').then((rows) => {
      $('#dlCount').textContent = String(rows.length);
      if (!rows.length) { box.innerHTML = '<p class="hint">Belum ada lagu yang diunduh. Putar lagu lalu tekan tombol Unduh.</p>'; return; }
      box.innerHTML = '';
      rows.forEach((r, i) => {
        const t = { id: r.id, title: r.title, artist: r.artist, album: r.album, url: r.url, duration: r.duration, source: 'archive', identifier: r.identifier, filename: r.filename };
        const div = document.createElement('div');
        div.className = 'track';
        div.innerHTML = '<span class="t-num">' + (i + 1) + '</span>' +
          '<div class="t-info"><div class="t-title">' + esc(r.title) + '</div>' +
          '<div class="t-sub">' + esc(r.artist) + ' · ' + fmtTime(r.duration) + '</div></div>' +
          '<span class="dl-badge">OFFLINE</span>';
        div.addEventListener('click', () => playAt(rows.map((x) => ({ id: x.id, title: x.title, artist: x.artist, album: x.album, url: x.url, duration: x.duration, source: 'archive', identifier: x.identifier, filename: x.filename })), i));
        const del = document.createElement('button');
        del.className = 'btn-small'; del.textContent = 'Hapus';
        del.addEventListener('click', (ev) => { ev.stopPropagation(); removeDownload(r.id, r.url); });
        div.appendChild(del);
        box.appendChild(div);
      });
    });
  }

  /* ---------- import local files (IndexedDB blobs) ---------- */
  $('#importBtn').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    let done = 0;
    files.forEach((f, i) => {
      const id = 'imp:' + Date.now() + ':' + i + ':' + f.name;
      idbPut('files', {
        id: id, title: f.name.replace(/\.[^.]+$/, ''), artist: 'File Saya',
        blob: f, type: f.type || '', size: f.size || 0, addedAt: Date.now()
      }).then(() => { done++; if (done === files.length) { renderMyFiles(); setStatus('Diimpor ' + files.length + ' file.'); } });
    });
    e.target.value = '';
  });
  function renderMyFiles() {
    const box = $('#myFilesList');
    idbAll('files').then((rows) => {
      $('#myCount').textContent = String(rows.length);
      if (!rows.length) { box.innerHTML = '<p class="hint">Belum ada file. Tekan tombol di atas untuk mengimpor musik dari perangkatmu.</p>'; return; }
      box.innerHTML = '';
      rows.forEach((r, i) => {
        const div = document.createElement('div');
        div.className = 'track';
        div.innerHTML = '<span class="t-num">' + (i + 1) + '</span>' +
          '<div class="t-info"><div class="t-title">' + esc(r.title) + '</div>' +
          '<div class="t-sub">File Saya · ' + (r.size ? (r.size / 1048576).toFixed(1) + ' MB' : '') + '</div></div>' +
          '<span class="dl-badge">OFFLINE</span>';
        div.addEventListener('click', () => {
          const list = rows.map((x) => ({ id: x.id, title: x.title, artist: 'File Saya', url: '', duration: 0, source: 'import', _blob: x.blob }));
          playAt(list, i);
        });
        const del = document.createElement('button');
        del.className = 'btn-small'; del.textContent = 'Hapus';
        del.addEventListener('click', (ev) => { ev.stopPropagation(); idbDel('files', r.id).then(() => renderMyFiles()); });
        div.appendChild(del);
        box.appendChild(div);
      });
    });
  }

  /* ---------- rendering: track list / favorites ---------- */
  function trackRow(t, list, index) {
    const div = document.createElement('div');
    div.className = 'track';
    div.dataset.tid = t.id;
    const dl = downloadedIds.has(t.id) ? '<span class="dl-badge">OFFLINE</span>' : '';
    div.innerHTML = '<span class="t-num">' + (index + 1) + '</span>' +
      '<div class="t-info"><div class="t-title">' + esc(t.title) + '</div>' +
      '<div class="t-sub">' + esc(t.artist) + (t.duration ? ' · ' + fmtTime(t.duration) : '') + '</div></div>' + dl;
    div.addEventListener('click', () => playAt(list, index));
    return div;
  }
  function markPlayingRow() {
    $$('.track').forEach((el) => el.classList.remove('playing'));
    const t = currentTrack();
    if (!t) return;
    $$('.track[data-tid="' + CSS.escape(t.id) + '"]').forEach((el) => el.classList.add('playing'));
  }
  function updateQueueLine() {
    const t = currentTrack();
    $('#queueLine').textContent = t ? ('Antrean: ' + (qi + 1) + '/' + queue.length + (shuffle ? ' · acak aktif' : '') + (repeatMode === 1 ? ' · ulang semua' : repeatMode === 2 ? ' · ulang satu' : '')) : '';
  }
  function renderFavs() {
    const box = $('#favList');
    if (!favs.length) { box.innerHTML = '<p class="hint">Belum ada favorit. Tekan ikon ♥ pada lagu yang sedang diputar.</p>'; return; }
    box.innerHTML = '';
    favs.forEach((f, i) => {
      const t = { id: f.id, title: f.title, artist: f.artist, album: f.album, url: f.url, duration: f.duration, source: f.source, identifier: f.identifier, filename: f.filename };
      box.appendChild(trackRow(t, favs.map((x) => ({ id: x.id, title: x.title, artist: x.artist, album: x.album, url: x.url, duration: x.duration, source: x.source, identifier: x.identifier, filename: x.filename })), i));
    });
  }

  /* ---------- search / browse ---------- */
  const GENRES = [
    { label: 'Jazz', q: 'jazz' }, { label: 'Rock', q: 'rock' }, { label: 'Klasik', q: 'classical' },
    { label: 'Pop', q: 'pop' }, { label: 'Folk', q: 'folk' }, { label: 'Live', q: 'collection:(etree)' },
    { label: 'Blues', q: 'blues' }, { label: 'Elektronik', q: 'electronic' }, { label: 'Reggae', q: 'reggae' },
    { label: 'Dangdut', q: 'dangdut' }, { label: 'Akustik', q: 'acoustic' }, { label: 'Gospel', q: 'gospel' }
  ];
  const chipsBox = $('#genreChips');
  GENRES.forEach((g) => {
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = g.label;
    b.addEventListener('click', () => {
      $$('.chip').forEach((c) => c.classList.remove('active'));
      b.classList.add('active');
      runSearch(g.q, g.label);
    });
    chipsBox.appendChild(b);
  });
  function runSearch(query, label) {
    setStatus('Mencari "' + (label || query) + '"…');
    $('#results').innerHTML = '';
    searchTracks(query, 8).then((tracks) => {
      if (!tracks.length) { setStatus('Tidak ditemukan untuk "' + (label || query) + '". Coba kata kunci lain.'); return; }
      setStatus(tracks.length + ' lagu ditemukan — ketuk untuk memutar.');
      const box = $('#results');
      tracks.forEach((t, i) => box.appendChild(trackRow(t, tracks, i)));
      markPlayingRow();
    }).catch(() => setStatus('Gagal terhubung. Periksa internet lalu coba lagi.'));
  }
  $('#searchBtn').addEventListener('click', () => {
    const q = $('#searchInput').value.trim();
    if (q) runSearch(q);
  });
  $('#searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const q = e.target.value.trim(); if (q) runSearch(q); } });

  /* ---------- tabs ---------- */
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach((t) => t.classList.remove('active'));
      $$('.tab-page').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      $('#tab-' + tab.dataset.tab).classList.add('active');
      if (tab.dataset.tab === 'unduhan') renderDownloads();
      if (tab.dataset.tab === 'filesaya') renderMyFiles();
      if (tab.dataset.tab === 'favorit') renderFavs();
    });
  });

  /* ---------- featured (verified full tracks) ---------- */
  const FEATURED = ['EnClaveDeJazz10', 'ElectromanALittleLouder', 'ElectroBailaTumbao'];
  function loadFeatured() {
    setStatus('Memuat lagu pilihan…');
    Promise.all(FEATURED.map((id) => archiveItemTracks(id).catch(() => [])))
      .then((lists) => {
        const tracks = lists.flat();
        if (!tracks.length) { setStatus('Gagal memuat. Coba cari lewat kolom pencarian.'); return; }
        setStatus('Lagu pilihan — ketuk untuk memutar. Atau cari lewat kolom di atas.');
        const box = $('#results');
        box.innerHTML = '';
        tracks.forEach((t, i) => box.appendChild(trackRow(t, tracks, i)));
        markPlayingRow();
      });
  }

  /* ---------- service worker ---------- */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  /* ---------- init ---------- */
  refreshDownloadedIds().then(() => { renderDownloads(); renderMyFiles(); });
  renderFavs();
  loadFeatured();
})();
