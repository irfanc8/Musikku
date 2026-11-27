/* Musikku v1.1 — pemutar musik online (Internet Archive) + offline (unduhan & file lokal)
   Fitur: Now Playing layar penuh + visualizer, playlist, riwayat, sleep timer,
   kecepatan putar, equalizer, manajer unduhan, beranda, tema terang/gelap, Media Session API. */
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
  function fmtSize(bytes) {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
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
  function hashStr(s) {
    let h = 0;
    s = String(s || '?');
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }
  /* Gradien sampul unik per lagu dari hash judul (dipakai juga sebagai placeholder art). */
  function coverGradient(title) {
    const h = hashStr(title || '?');
    const h1 = h % 360, h2 = (h1 + 70) % 360;
    return 'linear-gradient(135deg, hsl(' + h1 + ', 75%, 55%) 0%, hsl(' + h2 + ', 80%, 42%) 100%)';
  }
  function coverLetter(title) {
    const t = String(title || '?').trim();
    return (t.charAt(0) || '?').toUpperCase();
  }
  function trackThumb(t) {
    if (t && t.identifier) return 'https://archive.org/services/img/' + encodeURIComponent(t.identifier);
    return null;
  }
  /* Data URL sampul gradien (fallback artwork untuk Media Session saat tanpa thumbnail). */
  const artUrlCache = {};
  function gradientArtDataURL(title) {
    if (artUrlCache[title]) return artUrlCache[title];
    try {
      const c = document.createElement('canvas');
      c.width = 512; c.height = 512;
      const ctx = c.getContext('2d');
      const h = hashStr(title || '?');
      const g = ctx.createLinearGradient(0, 0, 512, 512);
      g.addColorStop(0, 'hsl(' + (h % 360) + ', 75%, 55%)');
      g.addColorStop(1, 'hsl(' + ((h % 360) + 70) % 360 + ', 80%, 42%)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 512);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = 'bold 260px -apple-system, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(coverLetter(title), 256, 270);
      artUrlCache[title] = c.toDataURL('image/png');
    } catch (e) { artUrlCache[title] = ''; }
    return artUrlCache[title];
  }

  /* ---------- storage: localStorage ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  let favs = store.get('musikku_favs', []);
  let recent = store.get('musikku_recent', []);
  let playlists = store.get('musikku_playlists', []);
  let openPlaylistId = null;

  /* ---------- tema terang / gelap ---------- */
  function applyTheme() {
    const theme = store.get('musikku_theme', 'dark');
    document.body.classList.toggle('light', theme === 'light');
    const btn = $('#themeToggle');
    if (btn) btn.textContent = theme === 'light' ? '☀️' : '🌙';
  }
  function toggleTheme() {
    const cur = store.get('musikku_theme', 'dark');
    store.set('musikku_theme', cur === 'light' ? 'dark' : 'light');
    applyTheme();
  }

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

  /* ---------- Web Audio: SATU AudioContext + SATU MediaElementSource ----------
     Dipakai bersama oleh visualizer DAN equalizer (jangan buat yang kedua). */
  let actx = null, analyser = null, eqFilters = null, audioGraphReady = false;
  const EQ_PRESETS = {
    normal: [0, 0, 0],
    bass: [7, 1, -2],
    treble: [-2, 0, 6],
    pop: [2, 3, 3],
    rock: [5, -2, 4],
    jazz: [3, 2, 4],
    vocal: [-2, 4, 2]
  };
  let eqPreset = store.get('musikku_eq', 'normal');
  function ensureAudioGraph() {
    if (audioGraphReady) { if (actx && actx.state === 'suspended') actx.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      actx = new AC();
      const src = actx.createMediaElementSource(audio);
      const low = actx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 200;
      const mid = actx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 1;
      const high = actx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 4000;
      analyser = actx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.75;
      src.connect(low); low.connect(mid); mid.connect(high); high.connect(analyser); analyser.connect(actx.destination);
      eqFilters = { low: low, mid: mid, high: high };
      applyEqPreset(eqPreset);
      audioGraphReady = true;
      if (actx.state === 'suspended') actx.resume().catch(() => {});
    } catch (e) { /* Web Audio tidak tersedia — pemutaran tetap jalan tanpa EQ/visualizer */ }
  }
  function applyEqPreset(name) {
    eqPreset = EQ_PRESETS[name] ? name : 'normal';
    store.set('musikku_eq', eqPreset);
    if (!eqFilters) return;
    const g = EQ_PRESETS[eqPreset];
    eqFilters.low.gain.value = g[0];
    eqFilters.mid.gain.value = g[1];
    eqFilters.high.gain.value = g[2];
  }

  /* ---------- visualizer (canvas frequency bars) ---------- */
  let vizRaf = null;
  function drawVisualizer() {
    const canvas = $('#vizCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    let data = null;
    if (analyser) {
      data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
    }
    const bars = 28;
    const bw = W / bars;
    for (let i = 0; i < bars; i++) {
      let v = 0.08;
      if (data) v = Math.max(0.06, (data[Math.floor((i / bars) * data.length)] || 0) / 255);
      if (audio.paused) v = 0.06;
      const bh = Math.max(3, v * H);
      const grad = ctx.createLinearGradient(0, H, 0, H - bh);
      grad.addColorStop(0, '#fa2d48');
      grad.addColorStop(1, '#ff9a5c');
      ctx.fillStyle = grad;
      const x = i * bw + 2;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, H - bh, bw - 4, bh, 3); else ctx.rect(x, H - bh, bw - 4, bh);
      ctx.fill();
    }
  }
  function startVizLoop() {
    if (vizRaf) return;
    const loop = () => { drawVisualizer(); vizRaf = requestAnimationFrame(loop); };
    vizRaf = requestAnimationFrame(loop);
  }
  function stopVizLoop() {
    if (vizRaf) { cancelAnimationFrame(vizRaf); vizRaf = null; }
    drawVisualizer();
  }

  /* ---------- Media Session API (iOS Lock Screen / Control Center + background) ----------
     Web-side saja; mode background native (UIBackgroundModes) ditangani terpisah.
     TIDAK ada kode yang menjeda audio saat dokumen hidden — pemutaran jalan terus. */
  function updateMediaSession(t) {
    if (!('mediaSession' in navigator) || !t) return;
    try {
      const artwork = [];
      const thumb = trackThumb(t);
      if (thumb) artwork.push({ src: thumb, sizes: '512x512', type: 'image/jpeg' });
      const grad = gradientArtDataURL(t.title);
      if (grad) artwork.push({ src: grad, sizes: '512x512', type: 'image/png' });
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title || 'Tanpa Judul',
        artist: t.artist || 'Musikku',
        album: t.album || 'Musikku',
        artwork: artwork
      });
    } catch (e) {}
  }
  function setupMediaSessionHandlers() {
    if (!('mediaSession' in navigator)) return;
    try {
      const ms = navigator.mediaSession;
      ms.setActionHandler('play', () => { ensureAudioGraph(); audio.play().catch(() => {}); });
      ms.setActionHandler('pause', () => audio.pause());
      ms.setActionHandler('previoustrack', () => prevTrack());
      ms.setActionHandler('nexttrack', () => nextTrack());
      ms.setActionHandler('seekto', (details) => {
        if (details && typeof details.seekTime === 'number' && isFinite(audio.duration)) {
          if (details.fastSeek && typeof audio.fastSeek === 'function') audio.fastSeek(details.seekTime);
          else audio.currentTime = Math.min(Math.max(0, details.seekTime), audio.duration);
        }
      });
      ms.setActionHandler('seekbackward', (details) => {
        const off = (details && details.seekOffset) || 10;
        audio.currentTime = Math.max(0, audio.currentTime - off);
      });
      ms.setActionHandler('seekforward', (details) => {
        const off = (details && details.seekOffset) || 10;
        if (isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration, audio.currentTime + off);
      });
    } catch (e) {}
  }

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
    setPlayerArt(t);
    updateFavBtn();
    updateDlBtn();
    updateQueueLine();
    markPlayingRow();
    updateNpFields();
    renderNpQueue();
    updateMediaSession(t);
    if (t.source === 'import' && t._blob) {
      if (audio._objUrl) URL.revokeObjectURL(audio._objUrl);
      audio._objUrl = URL.createObjectURL(t._blob);
      audio.src = audio._objUrl;
    } else {
      audio.src = t.url;
    }
    if (autoplay) { ensureAudioGraph(); audio.play().catch(() => {}); }
    pushRecent(t);
    renderRecent();
    renderHomeRecent();
  }
  function setPlayerArt(t) {
    const art = $('#playerArt');
    const thumb = trackThumb(t);
    art.style.background = coverGradient(t.title);
    if (thumb) {
      art.innerHTML = '<img src="' + esc(thumb) + '" alt="" onerror="this.remove()">';
    } else {
      art.textContent = coverLetter(t.title);
    }
  }
  function togglePlay() {
    if (!currentTrack()) return;
    ensureAudioGraph();
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
  function syncPlayButtons() {
    const icon = audio.paused ? '▶' : '⏸';
    $('#playBtn').textContent = icon;
    const np = $('#npPlayBtn');
    if (np) np.textContent = icon;
  }
  audio.addEventListener('ended', () => { if (repeatMode === 2) { audio.currentTime = 0; audio.play().catch(() => {}); } else nextTrack(); });
  audio.addEventListener('play', () => { syncPlayButtons(); markPlayingRow(); });
  audio.addEventListener('pause', () => { syncPlayButtons(); markPlayingRow(); });
  audio.addEventListener('timeupdate', () => {
    const d = audio.duration || 0;
    const cur = fmtTime(audio.currentTime), dur = fmtTime(d);
    $('#curTime').textContent = cur;
    $('#durTime').textContent = dur;
    const npC = $('#npCurTime'), npD = $('#npDurTime');
    if (npC) npC.textContent = cur;
    if (npD) npD.textContent = dur;
    if (d > 0) {
      const pct = String((audio.currentTime / d) * 100);
      $('#seekBar').value = pct;
      const npS = $('#npSeekBar');
      if (npS && document.activeElement !== npS) npS.value = pct;
    }
  });
  audio.addEventListener('loadedmetadata', () => { $('#durTime').textContent = fmtTime(audio.duration || 0); });
  function bindSeek(input) {
    input.addEventListener('input', (e) => {
      const d = audio.duration || 0;
      if (d > 0) audio.currentTime = (parseFloat(e.target.value) / 100) * d;
    });
  }
  bindSeek($('#seekBar'));
  bindSeek($('#npSeekBar'));
  function bindVolume(input) {
    input.addEventListener('input', (e) => {
      audio.volume = parseFloat(e.target.value);
      const v = $('#volBar'), nv = $('#npVolBar');
      if (v) v.value = e.target.value;
      if (nv) nv.value = e.target.value;
    });
  }
  bindVolume($('#volBar'));
  bindVolume($('#npVolBar'));
  $('#playBtn').addEventListener('click', togglePlay);
  $('#npPlayBtn').addEventListener('click', togglePlay);
  $('#nextBtn').addEventListener('click', nextTrack);
  $('#npNextBtn').addEventListener('click', nextTrack);
  $('#prevBtn').addEventListener('click', prevTrack);
  $('#npPrevBtn').addEventListener('click', prevTrack);
  function syncShuffleRepeat() {
    $('#shuffleBtn').classList.toggle('on', shuffle);
    $('#npShuffleBtn').classList.toggle('on', shuffle);
    const on = repeatMode > 0;
    $('#repeatBtn').classList.toggle('on', on);
    $('#npRepeatBtn').classList.toggle('on', on);
    $('#repeatBtn').textContent = repeatMode === 2 ? '🔂' : '🔁';
    $('#npRepeatBtn').textContent = repeatMode === 2 ? '🔂' : '🔁';
  }
  function toggleShuffle() { shuffle = !shuffle; syncShuffleRepeat(); updateQueueLine(); }
  function cycleRepeat() { repeatMode = (repeatMode + 1) % 3; syncShuffleRepeat(); updateQueueLine(); }
  $('#shuffleBtn').addEventListener('click', toggleShuffle);
  $('#npShuffleBtn').addEventListener('click', toggleShuffle);
  $('#repeatBtn').addEventListener('click', cycleRepeat);
  $('#npRepeatBtn').addEventListener('click', cycleRepeat);

  /* ---------- kecepatan putar ---------- */
  $('#speedSelect').addEventListener('change', (e) => {
    audio.playbackRate = parseFloat(e.target.value) || 1;
    audio.defaultPlaybackRate = audio.playbackRate;
  });

  /* ---------- sleep timer ---------- */
  let sleepTimeoutId = null, sleepCountdownId = null, sleepEndAt = 0;
  function updateSleepUI() {
    const remain = sleepEndAt ? Math.max(0, sleepEndAt - Date.now()) : 0;
    const label = remain > 0 ? '😴 ' + fmtTime(remain / 1000) : '';
    const cd = $('#sleepCountdown');
    if (cd) cd.textContent = label;
    const badge = $('#sleepBadge');
    if (badge) {
      badge.hidden = remain <= 0;
      badge.textContent = label;
    }
    if (remain <= 0 && $('#sleepSelect').value !== '0') $('#sleepSelect').value = '0';
  }
  function clearSleepTimer(silent) {
    if (sleepTimeoutId) { clearTimeout(sleepTimeoutId); sleepTimeoutId = null; }
    if (sleepCountdownId) { clearInterval(sleepCountdownId); sleepCountdownId = null; }
    sleepEndAt = 0;
    if (!silent) updateSleepUI();
  }
  function setSleepTimer(minutes) {
    clearSleepTimer(true);
    if (!minutes || minutes <= 0) { updateSleepUI(); return; }
    sleepEndAt = Date.now() + minutes * 60 * 1000;
    sleepTimeoutId = setTimeout(() => {
      audio.pause();
      clearSleepTimer();
      const st = $('#dlState');
      if (st) st.textContent = 'Sleep timer: pemutaran dihentikan';
    }, minutes * 60 * 1000);
    sleepCountdownId = setInterval(updateSleepUI, 1000);
    updateSleepUI();
  }
  $('#sleepSelect').addEventListener('change', (e) => setSleepTimer(parseInt(e.target.value, 10) || 0));

  /* ---------- favorites / recent ---------- */
  function isFav(id) { return favs.some((f) => f.id === id); }
  function serializableTrack(t) {
    return { id: t.id, title: t.title, artist: t.artist, album: t.album || '', url: t.url, duration: t.duration || 0, source: t.source, identifier: t.identifier || '', filename: t.filename || '' };
  }
  function toggleFav() {
    const t = currentTrack();
    if (!t) return;
    const i = favs.findIndex((f) => f.id === t.id);
    if (i >= 0) favs.splice(i, 1); else favs.unshift(serializableTrack(t));
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
    const np = $('#npFavBtn');
    if (np) np.textContent = f ? '♥ Favorit' : '♡ Favorit';
  }
  $('#favBtn').addEventListener('click', toggleFav);
  $('#npFavBtn').addEventListener('click', toggleFav);
  function pushRecent(t) {
    recent = recent.filter((r) => r.id !== t.id);
    recent.unshift(serializableTrack(t));
    if (recent.length > 30) recent.length = 30;
    store.set('musikku_recent', recent);
  }
  function renderRecent() {
    const box = $('#recentList');
    if (!box) return;
    if (!recent.length) { box.innerHTML = '<p class="hint">Belum ada riwayat. Putar sebuah lagu dulu.</p>'; return; }
    box.innerHTML = '';
    recent.forEach((r, i) => {
      const t = { id: r.id, title: r.title, artist: r.artist, album: r.album, url: r.url, duration: r.duration, source: r.source, identifier: r.identifier, filename: r.filename };
      box.appendChild(trackRow(t, recent.map((x) => ({ id: x.id, title: x.title, artist: x.artist, album: x.album, url: x.url, duration: x.duration, source: x.source, identifier: x.identifier, filename: x.filename })), i));
    });
  }
  function renderHomeRecent() {
    const box = $('#homeRecent');
    if (!box) return;
    const items = recent.slice(0, 5);
    if (!items.length) { box.innerHTML = '<p class="hint">Belum ada lagu yang diputar.</p>'; return; }
    box.innerHTML = '';
    items.forEach((r, i) => {
      const t = { id: r.id, title: r.title, artist: r.artist, album: r.album, url: r.url, duration: r.duration, source: r.source, identifier: r.identifier, filename: r.filename };
      box.appendChild(trackRow(t, recent.map((x) => ({ id: x.id, title: x.title, artist: x.artist, album: x.album, url: x.url, duration: x.duration, source: x.source, identifier: x.identifier, filename: x.filename })), i));
    });
  }
  $('#clearRecentBtn').addEventListener('click', () => {
    recent = [];
    store.set('musikku_recent', recent);
    renderRecent();
    renderHomeRecent();
  });

  /* ---------- downloads (Cache API + IndexedDB metadata, dengan progres) ---------- */
  const AUDIO_CACHE = 'musikku-audio-v1';
  function refreshDownloadedIds() {
    return idbAll('downloads').then((rows) => { downloadedIds = new Set(rows.map((r) => r.id)); $('#dlCount').textContent = String(rows.length); return rows; }).catch(() => []);
  }
  function showDlProgress(pct, label) {
    const wrap = $('#dlProgressWrap'), bar = $('#dlProgressBar'), txt = $('#dlProgressText');
    if (pct == null) { wrap.hidden = true; return; }
    wrap.hidden = false;
    bar.style.width = Math.min(100, Math.max(0, pct)) + '%';
    txt.textContent = label || (Math.round(pct) + '%');
  }
  /* Unduh dengan streaming reader: laporkan % saat Content-Length diketahui. */
  function downloadTrack(t, onProgress) {
    return fetch(t.url).then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const total = parseInt(res.headers.get('Content-Length') || '0', 10) || 0;
      if (!res.body || !res.body.getReader) return { blob: null, size: total, response: res };
      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;
      function pump() {
        return reader.read().then((r) => {
          if (r.done) return new Blob(chunks);
          chunks.push(r.value);
          received += r.value.byteLength;
          if (onProgress) onProgress(total ? (received / total) * 100 : -1, received, total);
          return pump();
        });
      }
      return pump().then((blob) => ({ blob: blob, size: received, response: null }));
    }).then((out) => {
      if (out.response) return caches.open(AUDIO_CACHE).then((c) => c.put(t.url, out.response)).then(() => out.size);
      return caches.open(AUDIO_CACHE).then((c) => c.put(t.url, new Response(out.blob))).then(() => out.size);
    });
  }
  function downloadCurrent() {
    const t = currentTrack();
    if (!t || t.source !== 'archive') return;
    downloadTrackById(t);
  }
  function downloadTrackById(t) {
    const btn = $('#dlBtn'), st = $('#dlState');
    if (btn) btn.disabled = true;
    if (st) st.textContent = 'Mengunduh…';
    showDlProgress(0, 'Memulai unduhan…');
    downloadTrack(t, (pct, received, total) => {
      if (pct >= 0) {
        showDlProgress(pct, Math.round(pct) + '% · ' + fmtSize(received) + (total ? ' / ' + fmtSize(total) : ''));
        if (st) st.textContent = 'Mengunduh ' + Math.round(pct) + '%';
      } else {
        showDlProgress(0, fmtSize(received) + ' diunduh…');
        if (st) st.textContent = 'Mengunduh ' + fmtSize(received) + '…';
      }
    }).then((size) => idbPut('downloads', {
      id: t.id, title: t.title, artist: t.artist, album: t.album || '', url: t.url,
      duration: t.duration || 0, identifier: t.identifier, filename: t.filename,
      size: size || 0, downloadedAt: Date.now()
    })).then(() => {
      if (st) st.textContent = '✓ Tersimpan offline';
      showDlProgress(100, 'Selesai ✓');
      setTimeout(() => showDlProgress(null), 2500);
      if (btn) btn.disabled = false;
      return refreshDownloadedIds();
    }).then(() => { updateDlBtn(); renderDownloads(); })
      .catch(() => {
        if (st) st.textContent = 'Gagal mengunduh';
        showDlProgress(null);
        if (btn) btn.disabled = false;
      });
  }
  $('#dlBtn').addEventListener('click', downloadCurrent);
  $('#npDlBtn').addEventListener('click', downloadCurrent);
  function updateDlBtn() {
    const t = currentTrack();
    const btn = $('#dlBtn'), st = $('#dlState');
    const npBtn = $('#npDlBtn');
    if (!t || t.source !== 'archive') {
      btn.style.display = 'none';
      if (npBtn) npBtn.style.display = 'none';
      st.textContent = '';
      return;
    }
    btn.style.display = '';
    if (npBtn) npBtn.style.display = '';
    if (downloadedIds.has(t.id)) {
      btn.disabled = true; btn.textContent = '✓ Diunduh'; st.textContent = 'Tersedia offline';
      if (npBtn) { npBtn.disabled = true; npBtn.textContent = '✓ Diunduh'; }
    } else {
      btn.disabled = false; btn.textContent = '⬇ Unduh'; st.textContent = '';
      if (npBtn) { npBtn.disabled = false; npBtn.textContent = '⬇ Unduh'; }
    }
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
        const sizeTxt = r.size ? fmtSize(r.size) : '';
        div.innerHTML = '<span class="t-num">' + (i + 1) + '</span>' +
          '<div class="t-info"><div class="t-title">' + esc(r.title) + '</div>' +
          '<div class="t-sub">' + esc(r.artist) + ' · ' + fmtTime(r.duration) + (sizeTxt ? ' · ' + sizeTxt : '') + '</div></div>' +
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

  /* ---------- playlists (localStorage) ---------- */
  function savePlaylists() { store.set('musikku_playlists', playlists); }
  function createPlaylist(name) {
    name = (name || '').trim();
    if (!name) return null;
    const pl = { id: 'pl:' + Date.now(), name: name, tracks: [], createdAt: Date.now() };
    playlists.unshift(pl);
    savePlaylists();
    renderPlaylists();
    return pl;
  }
  function getPlaylist(id) { return playlists.find((p) => p.id === id) || null; }
  function addTrackToPlaylist(plId, t) {
    const pl = getPlaylist(plId);
    if (!pl || !t) return false;
    if (pl.tracks.some((x) => x.id === t.id)) return false;
    pl.tracks.unshift(serializableTrack(t));
    savePlaylists();
    renderPlaylists();
    if (openPlaylistId === plId) renderPlaylistDetail(plId);
    return true;
  }
  function removeTrackFromPlaylist(plId, trackId) {
    const pl = getPlaylist(plId);
    if (!pl) return;
    pl.tracks = pl.tracks.filter((x) => x.id !== trackId);
    savePlaylists();
    renderPlaylistDetail(plId);
    renderPlaylists();
  }
  function deletePlaylist(plId) {
    playlists = playlists.filter((p) => p.id !== plId);
    if (openPlaylistId === plId) openPlaylistId = null;
    savePlaylists();
    renderPlaylists();
  }
  function renderPlaylists() {
    const box = $('#playlistsList');
    const detail = $('#playlistDetail');
    if (openPlaylistId) { box.hidden = true; detail.hidden = false; return; }
    box.hidden = false; detail.hidden = true;
    if (!playlists.length) { box.innerHTML = '<p class="hint">Belum ada playlist. Buat playlist lalu tambahkan lagu dari menu ⋯ pada lagu.</p>'; return; }
    box.innerHTML = '';
    playlists.forEach((pl) => {
      const div = document.createElement('div');
      div.className = 'card playlist-card';
      div.innerHTML = '<div class="pl-art" style="background:' + coverGradient(pl.name) + '">♪</div>' +
        '<div class="pl-info"><h3>' + esc(pl.name) + '</h3><div class="meta">' + pl.tracks.length + ' lagu</div></div>' +
        '<div class="row"><button class="btn-small primary pl-play">▶ Putar</button>' +
        '<button class="btn-small pl-open">Lihat</button>' +
        '<button class="btn-small pl-del">Hapus</button></div>';
      div.querySelector('.pl-play').addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (pl.tracks.length) playAt(pl.tracks.map((x) => ({ id: x.id, title: x.title, artist: x.artist, album: x.album, url: x.url, duration: x.duration, source: x.source, identifier: x.identifier, filename: x.filename })), 0);
      });
      div.querySelector('.pl-open').addEventListener('click', () => { openPlaylistId = pl.id; renderPlaylists(); renderPlaylistDetail(pl.id); });
      div.querySelector('.pl-del').addEventListener('click', (ev) => { ev.stopPropagation(); if (confirm('Hapus playlist "' + pl.name + '"?')) deletePlaylist(pl.id); });
      div.addEventListener('click', () => { openPlaylistId = pl.id; renderPlaylists(); renderPlaylistDetail(pl.id); });
      box.appendChild(div);
    });
  }
  function renderPlaylistDetail(plId) {
    const pl = getPlaylist(plId);
    const box = $('#playlistDetailList');
    if (!pl) { openPlaylistId = null; renderPlaylists(); return; }
    $('#playlistDetailName').textContent = pl.name + ' (' + pl.tracks.length + ' lagu)';
    if (!pl.tracks.length) { box.innerHTML = '<p class="hint">Playlist ini masih kosong. Tambahkan lagu dari menu ⋯ pada lagu.</p>'; return; }
    box.innerHTML = '';
    pl.tracks.forEach((r, i) => {
      const t = { id: r.id, title: r.title, artist: r.artist, album: r.album, url: r.url, duration: r.duration, source: r.source, identifier: r.identifier, filename: r.filename };
      const div = document.createElement('div');
      div.className = 'track';
      div.innerHTML = '<span class="t-num">' + (i + 1) + '</span>' +
        '<div class="t-info"><div class="t-title">' + esc(r.title) + '</div>' +
        '<div class="t-sub">' + esc(r.artist) + (r.duration ? ' · ' + fmtTime(r.duration) : '') + '</div></div>';
      div.addEventListener('click', () => playAt(pl.tracks.map((x) => ({ id: x.id, title: x.title, artist: x.artist, album: x.album, url: x.url, duration: x.duration, source: x.source, identifier: x.identifier, filename: x.filename })), i));
      const del = document.createElement('button');
      del.className = 'btn-small'; del.textContent = 'Hapus';
      del.addEventListener('click', (ev) => { ev.stopPropagation(); removeTrackFromPlaylist(pl.id, r.id); });
      div.appendChild(del);
      box.appendChild(div);
    });
  }
  $('#createPlaylistBtn').addEventListener('click', () => {
    const input = $('#newPlaylistName');
    const pl = createPlaylist(input.value);
    if (pl) input.value = '';
  });
  $('#newPlaylistName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const pl = createPlaylist(e.target.value); if (pl) e.target.value = ''; }
  });
  $('#backToPlaylists').addEventListener('click', () => { openPlaylistId = null; renderPlaylists(); });

  /* ---------- menu lagu (⋯): favorit / unduh / tambah ke playlist ---------- */
  let menuTrack = null;
  function openSongMenu(t) {
    menuTrack = t;
    $('#songMenuTitle').textContent = t.title;
    $('#songMenuArtist').textContent = t.artist + (t.album ? ' — ' + t.album : '');
    $('#songMenuFav').textContent = isFav(t.id) ? '♥ Hapus dari Favorit' : '♡ Tambah ke Favorit';
    const dlBtn = $('#songMenuDl');
    if (t.source !== 'archive') { dlBtn.style.display = 'none'; }
    else {
      dlBtn.style.display = '';
      dlBtn.textContent = downloadedIds.has(t.id) ? '✓ Sudah Diunduh' : '⬇ Unduh';
      dlBtn.disabled = downloadedIds.has(t.id);
    }
    const box = $('#songMenuPlaylists');
    box.innerHTML = '';
    if (!playlists.length) { box.innerHTML = '<p class="hint">Belum ada playlist — buat dulu di tab Playlist.</p>'; }
    playlists.forEach((pl) => {
      const b = document.createElement('button');
      const inPl = pl.tracks.some((x) => x.id === t.id);
      b.className = 'btn-small block-btn';
      b.textContent = (inPl ? '✓ ' : '+ ') + pl.name + ' (' + pl.tracks.length + ')';
      b.disabled = inPl;
      b.addEventListener('click', () => { addTrackToPlaylist(pl.id, t); closeSongMenu(); });
      box.appendChild(b);
    });
    $('#songMenu').hidden = false;
  }
  function closeSongMenu() { $('#songMenu').hidden = true; menuTrack = null; }
  $('#songMenuClose').addEventListener('click', closeSongMenu);
  $('#songMenuBackdrop').addEventListener('click', closeSongMenu);
  $('#songMenuFav').addEventListener('click', () => {
    if (!menuTrack) return;
    const i = favs.findIndex((f) => f.id === menuTrack.id);
    if (i >= 0) favs.splice(i, 1); else favs.unshift(serializableTrack(menuTrack));
    store.set('musikku_favs', favs);
    updateFavBtn(); renderFavs();
    closeSongMenu();
  });
  $('#songMenuDl').addEventListener('click', () => {
    if (!menuTrack) return;
    const t = menuTrack;
    closeSongMenu();
    downloadTrackById(t);
  });
  $('#npAddPlaylistBtn').addEventListener('click', () => { const t = currentTrack(); if (t) openSongMenu(t); });
  $('#npMenuBtn').addEventListener('click', () => { const t = currentTrack(); if (t) openSongMenu(t); });

  /* ---------- rendering: track list / favorites ---------- */
  function trackRow(t, list, index) {
    const div = document.createElement('div');
    div.className = 'track';
    div.dataset.tid = t.id;
    const dl = downloadedIds.has(t.id) ? '<span class="dl-badge">OFFLINE</span>' : '';
    const thumb = trackThumb(t);
    const artHtml = thumb
      ? '<div class="t-art"><img src="' + esc(thumb) + '" alt="" loading="lazy" onerror="this.parentNode.textContent=\'' + esc(coverLetter(t.title)) + '\';this.parentNode.style.background=\'' + coverGradient(t.title) + '\'"></div>'
      : '<div class="t-art" style="background:' + coverGradient(t.title) + '">' + esc(coverLetter(t.title)) + '</div>';
    div.innerHTML = '<span class="t-num">' + (index + 1) + '</span>' + artHtml +
      '<div class="t-info"><div class="t-title">' + esc(t.title) + '</div>' +
      '<div class="t-sub">' + esc(t.artist) + (t.duration ? ' · ' + fmtTime(t.duration) : '') + '</div></div>' + dl;
    const menuBtn = document.createElement('button');
    menuBtn.className = 'icon-btn t-menu';
    menuBtn.textContent = '⋯';
    menuBtn.title = 'Opsi lagu';
    menuBtn.addEventListener('click', (ev) => { ev.stopPropagation(); openSongMenu(t); });
    div.appendChild(menuBtn);
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

  /* ---------- Now Playing layar penuh ---------- */
  function updateNpFields() {
    const t = currentTrack();
    if (!t) return;
    $('#npTitle').textContent = t.title;
    $('#npArtist').textContent = t.artist + (t.album ? ' — ' + t.album : '');
    const art = $('#npArt');
    const thumb = trackThumb(t);
    art.style.background = coverGradient(t.title);
    if (thumb) {
      art.innerHTML = '<img src="' + esc(thumb) + '" alt="" onerror="this.remove()">';
    } else {
      art.textContent = '♪ ' + coverLetter(t.title);
    }
    syncPlayButtons();
    syncShuffleRepeat();
    updateDlBtn();
  }
  function renderNpQueue() {
    const box = $('#npQueue');
    if (!box) return;
    box.innerHTML = '';
    if (!queue.length) { box.innerHTML = '<p class="hint">Antrean kosong.</p>'; return; }
    queue.forEach((t, i) => {
      if (i === qi) return;
      const div = document.createElement('div');
      div.className = 'track';
      div.innerHTML = '<span class="t-num">' + (i + 1) + '</span>' +
        '<div class="t-art" style="background:' + coverGradient(t.title) + '">' + esc(coverLetter(t.title)) + '</div>' +
        '<div class="t-info"><div class="t-title">' + esc(t.title) + '</div>' +
        '<div class="t-sub">' + esc(t.artist) + (t.duration ? ' · ' + fmtTime(t.duration) : '') + '</div></div>';
      div.addEventListener('click', () => { qi = i; loadCurrent(true); });
      const del = document.createElement('button');
      del.className = 'btn-small'; del.textContent = '✕';
      del.title = 'Hapus dari antrean';
      del.addEventListener('click', (ev) => {
        ev.stopPropagation();
        queue.splice(i, 1);
        if (i < qi) qi--;
        updateQueueLine();
        renderNpQueue();
      });
      div.appendChild(del);
      box.appendChild(div);
    });
    if (!box.children.length) box.innerHTML = '<p class="hint">Tidak ada lagu berikutnya dalam antrean.</p>';
  }
  function openNowPlaying() {
    if (!currentTrack()) return;
    $('#nowPlaying').hidden = false;
    document.body.style.overflow = 'hidden';
    updateNpFields();
    renderNpQueue();
    startVizLoop();
  }
  function closeNowPlaying() {
    $('#nowPlaying').hidden = true;
    document.body.style.overflow = '';
    stopVizLoop();
  }
  $('#playerInfo').addEventListener('click', (e) => {
    if (e.target.closest('#favBtn')) return;
    openNowPlaying();
  });
  $('#npClose').addEventListener('click', closeNowPlaying);
  $('#eqPreset').addEventListener('change', (e) => { ensureAudioGraph(); applyEqPreset(e.target.value); });

  /* ---------- search / browse ---------- */
  const GENRES = [
    { label: 'Jazz', q: 'jazz' }, { label: 'Rock', q: 'rock' }, { label: 'Pop', q: 'pop' },
    { label: 'Dangdut', q: 'dangdut' }, { label: 'Klasik', q: 'classical' },
    { label: 'Elektronik', q: 'electronic' }, { label: 'Blues', q: 'blues' }, { label: 'Folk', q: 'folk' },
    { label: 'Live', q: 'collection:(etree)' }, { label: 'Akustik', q: 'acoustic' },
    { label: 'Reggae', q: 'reggae' }, { label: 'Gospel', q: 'gospel' }
  ];
  function makeGenreChip(g) {
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = g.label;
    b.addEventListener('click', () => {
      $$('.chip').forEach((c) => c.classList.remove('active'));
      b.classList.add('active');
      switchTab('jelajah');
      runSearch(g.q, g.label);
    });
    return b;
  }
  GENRES.forEach((g) => {
    $('#genreChips').appendChild(makeGenreChip(g));
    $('#genreChipsHome').appendChild(makeGenreChip(g));
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
    if (q) { switchTab('jelajah'); runSearch(q); }
  });
  $('#searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const q = e.target.value.trim(); if (q) { switchTab('jelajah'); runSearch(q); } } });

  /* ---------- tabs ---------- */
  function switchTab(name) {
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    $$('.tab-page').forEach((p) => p.classList.remove('active'));
    const page = $('#tab-' + name);
    if (page) page.classList.add('active');
    if (name === 'unduhan') renderDownloads();
    if (name === 'filesaya') renderMyFiles();
    if (name === 'favorit') renderFavs();
    if (name === 'playlist') renderPlaylists();
    if (name === 'riwayat') renderRecent();
    if (name === 'beranda') renderHomeRecent();
  }
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  /* ---------- featured (verified full tracks) + beranda ---------- */
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
        renderFeaturedRow(tracks);
      });
  }
  function renderFeaturedRow(tracks) {
    const row = $('#featuredRow');
    if (!row) return;
    row.innerHTML = '';
    tracks.slice(0, 8).forEach((t, i) => {
      const card = document.createElement('div');
      card.className = 'featured-card';
      const thumb = trackThumb(t);
      const artHtml = thumb
        ? '<div class="feat-art"><img src="' + esc(thumb) + '" alt="" loading="lazy" onerror="this.remove()"></div>'
        : '<div class="feat-art" style="background:' + coverGradient(t.title) + '"><span>♪</span></div>';
      card.innerHTML = artHtml +
        '<div class="feat-title">' + esc(t.title) + '</div>' +
        '<div class="feat-artist">' + esc(t.artist) + '</div>';
      card.addEventListener('click', () => playAt(tracks, i));
      row.appendChild(card);
    });
  }

  /* ---------- tema ---------- */
  $('#themeToggle').addEventListener('click', toggleTheme);

  /* ---------- service worker ---------- */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  /* ---------- init ---------- */
  applyTheme();
  const eqSel = $('#eqPreset');
  if (eqSel) eqSel.value = eqPreset;
  setupMediaSessionHandlers();
  refreshDownloadedIds().then(() => { renderDownloads(); renderMyFiles(); });
  renderFavs();
  renderPlaylists();
  renderRecent();
  renderHomeRecent();
  loadFeatured();
})();
