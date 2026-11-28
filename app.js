/* Musikku v1.7 — pemutar musik online (Internet Archive + SoundCloud) + offline (unduhan & file lokal)
   Fitur: Now Playing layar penuh + visualizer simulasi, playlist, riwayat, sleep timer,
   kecepatan putar, manajer unduhan, beranda, tema terang/gelap, Media Session API,
   Koleksi Pilihan (Pop Indo, Pop Punk / Skate Punk Indo, Ska Indo, Reggae Indo), SoundCloud.
   v1.3: audio diputar LANGSUNG oleh <audio> (tanpa Web Audio) agar tetap jalan di latar
   belakang iOS; equalizer dihapus (butuh Web Audio); visualizer diganti animasi simulasi;
   tampilan terinspirasi SoundCloud (aksen oranye, waveform seek bar).
   v1.4: SoundCloud memakai CapacitorHttp (HTTP native, tanpa CORS) — fetch() biasa diblokir
   api-v2.soundcloud.com dari origin capacitor://localhost. Koleksi Amerika (Archive) +
   Indie Indo Kekinian (akun SoundCloud resmi); konten kurasi hanya Amerika + Indonesia.
   v1.5: perbaikan ganti lagu saat sedang memutar (pause + load + play aman + token urutan
   resolve SoundCloud); foto asli di kartu koleksi & baris lagu; ikon pemain SVG kustom +
   tema hangat; koleksi workaround via SoundCloud untuk lagu Indo trending yang tidak ada
   di akun resmi (Barasuara, Nadin Amizah, The Jansen, Threesixty, .Feast Tarot/Nina).
   v1.6: SEMUA koleksi Archive luar dihapus — konten kurasi kini hanya Indonesia (Archive +
   SoundCloud) + lagu luar yang sedang trend di TikTok/Instagram & koleksi artis luar,
   semuanya via SoundCloud (koleksi trending memakai daftar ID track terverifikasi;
   koleksi artis memakai pencarian SoundCloud dinamis).
   v1.7: TEMA SAJA — tampilan dirombak gaya Apple Music (terang, bersih, aksen merah,
   judul besar, hero "Viral di TikTok & Reels" di Beranda yang membuka koleksi Trending
   TikTok). Isi lagu & semua perilaku SAMA seperti v1.6. Tema gelap hangat (v1.5)
   dipertahankan sebagai pilihan toggle (kunci tema baru: musikku_theme_v17, default
   terang — pengguna lama v1.6 mendapat tampilan baru saat pertama buka v1.7). */
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
    if (t && t.artwork) return t.artwork;
    if (t && t.identifier) return 'https://archive.org/services/img/' + encodeURIComponent(t.identifier);
    return null;
  }
  /* ---------- ikon SVG kustom (v1.5) ----------
     Semua ikon pemain digambar sebagai SVG inline — bukan emoji/karakter dasar.
     Gaya konsisten: fill currentColor, viewBox 24, aksen oranye lewat CSS. */
  const ICONS = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.4v13.2c0 .8.9 1.3 1.6.9l10.2-6.6c.6-.4.6-1.4 0-1.8L9.6 4.5c-.7-.4-1.6.1-1.6.9z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4.8" width="4.2" height="14.4" rx="1.4"/><rect x="13.8" y="4.8" width="4.2" height="14.4" rx="1.4"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.4" y="5" width="2.6" height="14" rx="1"/><path d="M20 6.1v11.8c0 .8-.9 1.3-1.6.9L9 12.9c-.6-.4-.6-1.4 0-1.8l9.4-5.9c.7-.4 1.6.1 1.6.9z"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="16" y="5" width="2.6" height="14" rx="1"/><path d="M4 6.1v11.8c0 .8.9 1.3 1.6.9l9.4-5.9c.6-.4.6-1.4 0-1.8L5.6 5.2c-.7-.4-1.6.1-1.6.9z"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>',
    repeat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>',
    repeatOne: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/></svg>',
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
    heartOutline: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z"/></svg>',
    download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
    volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>',
    sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm20 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 20v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0 .39-.39.39-1.03 0-1.41l-1.06-1.06zm1.06-10.96c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0-1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z"/></svg>',
    moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/></svg>',
    chevronDown: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
    note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg>',
    sparkle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2zm7 11l.9 2.9 2.9.9-2.9.9-.9 2.9-.9-2.9-2.9-.9 2.9-.9.9-2.9z"/></svg>'
  };
  function icon(name) { return ICONS[name] || ''; }
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

  /* ---------- tema terang / gelap (v1.7: default terang gaya Apple Music) ---------- */
  function applyTheme() {
    const theme = store.get('musikku_theme_v17', 'light');
    document.body.classList.toggle('dark', theme === 'dark');
    const btn = $('#themeToggle');
    if (btn) btn.innerHTML = icon(theme === 'light' ? 'sun' : 'moon');
  }
  function toggleTheme() {
    const cur = store.get('musikku_theme_v17', 'light');
    store.set('musikku_theme_v17', cur === 'light' ? 'dark' : 'light');
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

  /* ---------- Pemutaran langsung (tanpa Web Audio) ----------
     v1.3: <audio> diputar LANGSUNG (jalur media native) agar iOS tetap memutarnya saat
     aplikasi diminimalkan / layar dikunci (UIBackgroundModes=audio). Web Audio
     (MediaElementSource) TIDAK dipakai — konteksnya disuspend iOS di latar belakang
     dan menghentikan audio. Karena itu equalizer dihapus dan visualizer diganti
     animasi simulasi (lihat drawVisualizer). */

  /* ---------- visualizer SIMULASI (animasi bar, bukan data frekuensi) ----------
     v1.3: tanpa Web Audio, tidak ada data frekuensi asli. Bar dianimasikan dari waktu
     pemutaran (audio.currentTime) + fase per bar — gerakannya halus dan mengikuti
     ritme putar/jeda. Saat dijeda, bar mereda ke level datar. */
  let vizRaf = null;
  const VIZ_BARS = 28;
  const vizLevels = new Array(VIZ_BARS).fill(0.06);
  function vizTarget(i, t) {
    // gabungan dua gelombang sinus + variasi per bar (deterministik per bar & waktu)
    const a = Math.sin(t * 2.1 + i * 0.9) * 0.5 + 0.5;
    const b = Math.sin(t * 3.7 + i * 0.35 + 1.7) * 0.5 + 0.5;
    const c = Math.sin(t * 0.9 + i * 1.9) * 0.5 + 0.5;
    return 0.12 + 0.75 * (a * 0.55 + b * 0.30 + c * 0.15);
  }
  function drawVisualizer() {
    const canvas = $('#vizCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const playing = !audio.paused && !!currentTrack();
    const t = audio.currentTime || 0;
    const bars = VIZ_BARS;
    const bw = W / bars;
    for (let i = 0; i < bars; i++) {
      const target = playing ? vizTarget(i, t) : 0.06;
      vizLevels[i] += (target - vizLevels[i]) * 0.18;
      const v = Math.max(0.05, Math.min(1, vizLevels[i]));
      const bh = Math.max(3, v * H);
      const grad = ctx.createLinearGradient(0, H, 0, H - bh);
      grad.addColorStop(0, '#ff6a00');
      grad.addColorStop(1, '#ffb347');
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
      ms.setActionHandler('play', () => { audio.play().catch(() => {}); });
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

  /* ---------- SoundCloud API v2 ----------
     client_id publik yang diambil dari JavaScript web player SoundCloud (terverifikasi
     2026-11-27: pencarian HTTP 200, stream HLS ter-resolve ke playlist .m3u8 yang valid).
     PENTING (v1.4): api-v2.soundcloud.com TIDAK mengizinkan CORS dari origin
     capacitor://localhost — fetch() biasa selalu diblokir di WebView iOS. Karena itu
     semua panggilan SoundCloud memakai CapacitorHttp (HTTP native, tanpa CORS) bila
     tersedia; fetch() hanya dipakai sebagai fallback di web/PWA.
     Stream: transcodings HLS (iOS Safari/WKWebView memutar HLS secara native).
     URL stream di-resolve saat lagu diputar (bukan saat pencarian) karena URL-nya
     bertanda tangan dan cepat kedaluwarsa. */
  const SC_CLIENT_ID = 'zQBXL76oebJv6L1OhUMMtNEmdG6Th0wF';
  const SC_API = 'https://api-v2.soundcloud.com';
  /* GET JSON lewat HTTP native (CapacitorHttp) bila tersedia — menembus CORS;
     fallback ke fetch() di web/PWA. Mengembalikan Promise<objek JSON>. */
  function scGetJson(url) {
    var http = (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins)
      ? window.Capacitor.Plugins.CapacitorHttp : null;
    if (http && typeof http.get === 'function') {
      return http.get({ url: url }).then(function (res) {
        if (!res || res.status < 200 || res.status >= 300) throw new Error('HTTP ' + (res && res.status));
        return res.data;
      });
    }
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function scArtwork(t) {
    const a = t.artwork_url || (t.user && t.user.avatar_url) || '';
    if (!a) return '';
    return a.replace('-large.', '-t500x500.').replace('-large.jpg', '-t500x500.jpg');
  }
  /* Petakan satu track SoundCloud API ke bentuk track aplikasi. */
  function mapSoundCloudTrack(t) {
    const trs = (t.media && t.media.transcodings) || [];
    const prog = trs.find((x) => x.format && x.format.protocol === 'progressive');
    const hls = trs.find((x) => x.format && x.format.protocol === 'hls');
    const chosen = prog || hls;
    if (!chosen) return null;
    return {
      id: 'sc:' + t.id,
      title: t.title || 'Tanpa Judul',
      artist: (t.user && t.user.username) || 'SoundCloud',
      album: 'SoundCloud',
      url: '', // diisi saat diputar (resolveSoundCloudStream)
      duration: Math.round((t.duration || 0) / 1000),
      source: 'soundcloud',
      artwork: scArtwork(t),
      streamUrl: chosen.url,
      streamProtocol: chosen.format.protocol
    };
  }
  function soundcloudSearch(query, limit) {
    const url = SC_API + '/search/tracks?' + new URLSearchParams({
      q: query, client_id: SC_CLIENT_ID, limit: String(limit || 20), linked_partitioning: '1'
    }).toString();
    return scGetJson(url).then((d) => {
      const list = (d.collection || []).filter((t) => t && t.media && t.media.transcodings && t.media.transcodings.length && t.duration);
      return list.map(mapSoundCloudTrack).filter(Boolean);
    });
  }
  /* Daftar track dari akun SoundCloud resmi seorang artis (dipakai koleksi Indie Indo).
     Hanya akun resmi yang dipakai — track di-resolve saat diputar seperti pencarian. */
  function soundcloudUserTracks(userId, limit) {
    const url = SC_API + '/users/' + userId + '/tracks?' + new URLSearchParams({
      client_id: SC_CLIENT_ID, limit: String(limit || 50)
    }).toString();
    return scGetJson(url).then((d) => {
      const list = Array.isArray(d) ? d : (d.collection || []);
      return list.filter((t) => t && t.media && t.media.transcodings && t.media.transcodings.length && t.duration)
        .map(mapSoundCloudTrack).filter(Boolean);
    });
  }
  /* Daftar track SoundCloud dari daftar ID yang sudah terverifikasi (dipakai koleksi
     trending TikTok/Instagram v1.6 — tiap ID dicek saat build: pencarian mengembalikan
     upload lagu penuh dan stream-nya ter-resolve ke URL yang menjawab HTTP 200).
     Urutan ID dipertahankan seperti di daftar. */
  function soundcloudTracksByIds(ids) {
    const url = SC_API + '/tracks?' + new URLSearchParams({
      ids: ids.join(','), client_id: SC_CLIENT_ID
    }).toString();
    return scGetJson(url).then((d) => {
      const list = Array.isArray(d) ? d : (d.collection || []);
      const byId = {};
      list.forEach((t) => { if (t) byId[t.id] = t; });
      return ids.map((id) => byId[id])
        .filter((t) => t && t.media && t.media.transcodings && t.media.transcodings.length && t.duration)
        .map(mapSoundCloudTrack).filter(Boolean);
    });
  }
  /* Resolve URL stream SoundCloud (transcoding URL + client_id -> JSON {url}). */
  function resolveSoundCloudStream(t) {
    if (!t.streamUrl) return Promise.reject(new Error('no stream'));
    if (t._resolvedUrl && t._resolvedAt && (Date.now() - t._resolvedAt) < 20 * 60 * 1000) {
      return Promise.resolve(t._resolvedUrl);
    }
    return scGetJson(t.streamUrl + (t.streamUrl.indexOf('?') === -1 ? '?' : '&') + 'client_id=' + SC_CLIENT_ID)
      .then((d) => {
        if (!d.url) throw new Error('no url');
        t._resolvedUrl = d.url;
        t._resolvedAt = Date.now();
        return d.url;
      });
  }

  /* ---------- playback ----------
     v1.5 — perbaikan ganti lagu saat sedang memutar. Akar masalah: mengganti audio.src
     saat lagu sedang jalan lalu langsung memanggil play() membuat iOS menolak play()
     (AbortError — play yang tertunda dibatalkan oleh load baru), dan .catch(()=>{})
     menelan penolakan itu diam-diam sehingga lagu baru tidak pernah bunyi padahal judul
     di UI sudah berubah. Perbaikan: pause dulu, ganti src, panggil load(), lalu play()
     lewat playAudioSafe() yang mencoba lagi sekali saat canplay/timeout bila ditolak.
     Resolve SoundCloud yang sudah kedaluwarsa diabaikan lewat token urutan (playSeq),
     bukan hanya perbandingan objek — jadi resolve lama tidak bisa menimpa lagu baru. */
  let playSeq = 0;
  function playAudioSafe() {
    let p = null;
    try { p = audio.play(); } catch (e) { p = null; }
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        const retry = () => { try { const q = audio.play(); if (q && q.catch) q.catch(() => {}); } catch (e) {} };
        audio.addEventListener('canplay', retry, { once: true });
        setTimeout(retry, 350);
      });
    }
  }
  function playAt(list, index) {
    if (!list || !list.length) return;
    queue = list.slice();
    qi = index;
    loadCurrent(true);
  }
  function loadCurrent(autoplay) {
    const t = currentTrack();
    if (!t) return;
    const seq = ++playSeq;
    const bar = $('#playerBar');
    bar.classList.remove('hidden');
    $('#nowTitle').textContent = t.title;
    $('#nowArtist').textContent = t.artist + (t.album ? ' — ' + t.album : '');
    setPlayerArt(t);
    waveMini.setTrack(t);
    waveNp.setTrack(t);
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
      audio.pause();
      audio.src = audio._objUrl;
      audio.load();
      if (autoplay) playAudioSafe();
    } else if (t.source === 'soundcloud') {
      // Resolve URL stream saat diputar (URL bertanda tangan, cepat kedaluwarsa).
      setStatus('Memuat stream SoundCloud…');
      resolveSoundCloudStream(t).then((streamUrl) => {
        if (seq !== playSeq || currentTrack() !== t) return; // sudah pindah lagu — abaikan
        audio.pause();
        audio.src = streamUrl;
        audio.load();
        if (autoplay) playAudioSafe();
      }).catch(() => {
        if (seq !== playSeq || currentTrack() !== t) return;
        setStatus('Gagal memuat stream SoundCloud. Coba lagu lain atau periksa internet.');
      });
      pushRecent(t);
      renderRecent();
      renderHomeRecent();
      return;
    } else {
      audio.pause();
      audio.src = t.url;
      audio.load();
      if (autoplay) playAudioSafe();
    }
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
      art.innerHTML = icon('note');
    }
  }
  function togglePlay() {
    if (!currentTrack()) return;
    if (audio.paused) playAudioSafe(); else audio.pause();
  }
  function nextTrack() {
    if (!queue.length) return;
    if (repeatMode === 2) { audio.currentTime = 0; playAudioSafe(); return; }
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
    const name = audio.paused ? 'play' : 'pause';
    $('#playBtn').innerHTML = icon(name);
    const np = $('#npPlayBtn');
    if (np) np.innerHTML = icon(name);
  }
  audio.addEventListener('ended', () => { if (repeatMode === 2) { audio.currentTime = 0; playAudioSafe(); } else nextTrack(); });
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
      const frac = audio.currentTime / d;
      waveMini.setProgress(frac);
      waveNp.setProgress(frac);
    }
  });
  audio.addEventListener('loadedmetadata', () => { $('#durTime').textContent = fmtTime(audio.duration || 0); });

  /* ---------- Waveform seek bar (gaya SoundCloud, bukan salinan) ----------
     Batang-batang gelombang deterministik per lagu (seed dari hash id lagu) —
     bentuknya stabil tiap lagu. Bagian yang sudah diputar berwarna oranye,
     sisanya abu-abu. Ketuk/seret untuk seek. */
  function makeWaveSeek(canvas) {
    const ws = { canvas: canvas, bars: [], progress: 0, dragging: false };
    function seedFrom(str) {
      let h = 2166136261;
      const s = String(str || '?');
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      return h >>> 0;
    }
    function regen(track) {
      let x = seedFrom(track ? track.id : 'musikku');
      const n = 64;
      ws.bars = [];
      for (let i = 0; i < n; i++) {
        x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
        const r = x / 4294967296;
        const env = 0.55 + 0.45 * Math.sin((i / n) * Math.PI);
        ws.bars.push(0.15 + 0.85 * r * env);
      }
      ws.progress = 0;
      draw();
    }
    function draw() {
      const c = ws.canvas;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (!w || !h) return;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const n = ws.bars.length;
      const gap = 2, bw = (w - gap * (n - 1)) / n;
      for (let i = 0; i < n; i++) {
        const bh = Math.max(3, ws.bars[i] * h);
        const x = i * (bw + gap);
        const played = (i + 0.5) / n <= ws.progress;
        ctx.fillStyle = played ? '#ff6a00' : 'rgba(150,150,155,0.55)';
        const y = (h - bh) / 2;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, 1.5); else ctx.rect(x, y, bw, bh);
        ctx.fill();
      }
    }
    function fracFromEvent(e) {
      const r = ws.canvas.getBoundingClientRect();
      return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    }
    function seekTo(frac) {
      const d = audio.duration || 0;
      if (d > 0) audio.currentTime = frac * d;
      ws.progress = frac;
      draw();
    }
    ws.canvas.addEventListener('pointerdown', (e) => {
      ws.dragging = true;
      try { ws.canvas.setPointerCapture(e.pointerId); } catch (err) {}
      seekTo(fracFromEvent(e));
    });
    ws.canvas.addEventListener('pointermove', (e) => { if (ws.dragging) seekTo(fracFromEvent(e)); });
    ws.canvas.addEventListener('pointerup', () => { ws.dragging = false; });
    ws.canvas.addEventListener('pointercancel', () => { ws.dragging = false; });
    ws.setTrack = regen;
    ws.setProgress = (f) => { ws.progress = Math.min(1, Math.max(0, f)); draw(); };
    ws.redraw = draw;
    return ws;
  }
  const waveMini = makeWaveSeek($('#waveMini'));
  const waveNp = makeWaveSeek($('#waveNp'));
  waveMini.setTrack(null);
  waveNp.setTrack(null);
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
    $('#repeatBtn').innerHTML = icon(repeatMode === 2 ? 'repeatOne' : 'repeat');
    $('#npRepeatBtn').innerHTML = icon(repeatMode === 2 ? 'repeatOne' : 'repeat');
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
    const label = remain > 0 ? fmtTime(remain / 1000) : '';
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
    return { id: t.id, title: t.title, artist: t.artist, album: t.album || '', url: t.url, duration: t.duration || 0, source: t.source, identifier: t.identifier || '', filename: t.filename || '', artwork: t.artwork || '', streamUrl: t.streamUrl || '' };
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
    if (!t) { b.innerHTML = icon('heartOutline'); b.classList.remove('faved'); return; }
    const f = isFav(t.id);
    b.innerHTML = icon(f ? 'heart' : 'heartOutline');
    b.classList.toggle('faved', f);
    const np = $('#npFavBtn');
    if (np) np.innerHTML = icon(f ? 'heart' : 'heartOutline') + '<span>Favorit</span>';
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
      const t = { id: r.id, title: r.title, artist: r.artist, album: r.album, url: r.url, duration: r.duration, source: r.source, identifier: r.identifier, filename: r.filename, artwork: r.artwork || '', streamUrl: r.streamUrl || '' };
      box.appendChild(trackRow(t, recent.map((x) => ({ id: x.id, title: x.title, artist: x.artist, album: x.album, url: x.url, duration: x.duration, source: x.source, identifier: x.identifier, filename: x.filename, artwork: x.artwork || '', streamUrl: x.streamUrl || '' })), i));
    });
  }
  function renderHomeRecent() {
    const box = $('#homeRecent');
    if (!box) return;
    const items = recent.slice(0, 5);
    if (!items.length) { box.innerHTML = '<p class="hint">Belum ada lagu yang diputar.</p>'; return; }
    box.innerHTML = '';
    items.forEach((r, i) => {
      const t = { id: r.id, title: r.title, artist: r.artist, album: r.album, url: r.url, duration: r.duration, source: r.source, identifier: r.identifier, filename: r.filename, artwork: r.artwork || '', streamUrl: r.streamUrl || '' };
      box.appendChild(trackRow(t, recent.map((x) => ({ id: x.id, title: x.title, artist: x.artist, album: x.album, url: x.url, duration: x.duration, source: x.source, identifier: x.identifier, filename: x.filename, artwork: x.artwork || '', streamUrl: x.streamUrl || '' })), i));
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
      btn.disabled = true; btn.innerHTML = icon('check') + '<span>Diunduh</span>'; st.textContent = 'Tersedia offline';
      if (npBtn) { npBtn.disabled = true; npBtn.innerHTML = icon('check') + '<span>Diunduh</span>'; }
    } else {
      btn.disabled = false; btn.innerHTML = icon('download') + '<span>Unduh</span>'; st.textContent = '';
      if (npBtn) { npBtn.disabled = false; npBtn.innerHTML = icon('download') + '<span>Unduh</span>'; }
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
        const dthumb = trackThumb(t);
        const dart = dthumb
          ? '<div class="t-art"><img src="' + esc(dthumb) + '" alt="" loading="lazy" onerror="this.remove()"></div>'
          : '<div class="t-art" style="background:' + coverGradient(t.title) + '">' + esc(coverLetter(t.title)) + '</div>';
        div.innerHTML = '<span class="t-num">' + (i + 1) + '</span>' + dart +
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
    if (!playlists.length) { box.innerHTML = '<p class="hint">Belum ada playlist. Buat playlist lalu tambahkan lagu dari menu titik tiga pada lagu.</p>'; return; }
    box.innerHTML = '';
    playlists.forEach((pl) => {
      const div = document.createElement('div');
      div.className = 'card playlist-card';
      div.innerHTML = '<div class="pl-art" style="background:' + coverGradient(pl.name) + '">' + icon('note') + '</div>' +
        '<div class="pl-info"><h3>' + esc(pl.name) + '</h3><div class="meta">' + pl.tracks.length + ' lagu</div></div>' +
        '<div class="row"><button class="btn-small primary pl-play">' + icon('play') + '<span>Putar</span></button>' +
        '<button class="btn-small pl-open">Lihat</button>' +
        '<button class="btn-small pl-del">Hapus</button></div>';
      div.querySelector('.pl-play').addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (pl.tracks.length) playAt(pl.tracks.map((x) => ({ id: x.id, title: x.title, artist: x.artist, album: x.album, url: x.url, duration: x.duration, source: x.source, identifier: x.identifier, filename: x.filename, artwork: x.artwork || '', streamUrl: x.streamUrl || '' })), 0);
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
    if (!pl.tracks.length) { box.innerHTML = '<p class="hint">Playlist ini masih kosong. Tambahkan lagu dari menu titik tiga pada lagu.</p>'; return; }
    box.innerHTML = '';
    pl.tracks.forEach((r, i) => {
      const t = { id: r.id, title: r.title, artist: r.artist, album: r.album, url: r.url, duration: r.duration, source: r.source, identifier: r.identifier, filename: r.filename, artwork: r.artwork || '', streamUrl: r.streamUrl || '' };
      const div = document.createElement('div');
      div.className = 'track';
      div.innerHTML = '<span class="t-num">' + (i + 1) + '</span>' +
        '<div class="t-info"><div class="t-title">' + esc(r.title) + '</div>' +
        '<div class="t-sub">' + esc(r.artist) + (r.duration ? ' · ' + fmtTime(r.duration) : '') + '</div></div>';
      div.addEventListener('click', () => playAt(pl.tracks.map((x) => ({ id: x.id, title: x.title, artist: x.artist, album: x.album, url: x.url, duration: x.duration, source: x.source, identifier: x.identifier, filename: x.filename, artwork: x.artwork || '', streamUrl: x.streamUrl || '' })), i));
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

  /* ---------- menu lagu: favorit / unduh / tambah ke playlist ---------- */
  let menuTrack = null;
  function openSongMenu(t) {
    menuTrack = t;
    $('#songMenuTitle').textContent = t.title;
    $('#songMenuArtist').textContent = t.artist + (t.album ? ' — ' + t.album : '');
    $('#songMenuFav').innerHTML = icon(isFav(t.id) ? 'heart' : 'heartOutline') + '<span>' + (isFav(t.id) ? 'Hapus dari Favorit' : 'Tambah ke Favorit') + '</span>';
    const dlBtn = $('#songMenuDl');
    if (t.source !== 'archive') { dlBtn.style.display = 'none'; }
    else {
      dlBtn.style.display = '';
      dlBtn.innerHTML = downloadedIds.has(t.id) ? icon('check') + '<span>Sudah Diunduh</span>' : icon('download') + '<span>Unduh</span>';
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
    menuBtn.innerHTML = icon('more');
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
      const t = { id: f.id, title: f.title, artist: f.artist, album: f.album, url: f.url, duration: f.duration, source: f.source, identifier: f.identifier, filename: f.filename, artwork: f.artwork || '', streamUrl: f.streamUrl || '' };
      box.appendChild(trackRow(t, favs.map((x) => ({ id: x.id, title: x.title, artist: x.artist, album: x.album, url: x.url, duration: x.duration, source: x.source, identifier: x.identifier, filename: x.filename, artwork: x.artwork || '', streamUrl: x.streamUrl || '' })), i));
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
      art.innerHTML = icon('note');
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
      const qthumb = trackThumb(t);
      const qart = qthumb
        ? '<div class="t-art"><img src="' + esc(qthumb) + '" alt="" loading="lazy" onerror="this.remove()"></div>'
        : '<div class="t-art" style="background:' + coverGradient(t.title) + '">' + esc(coverLetter(t.title)) + '</div>';
      div.innerHTML = '<span class="t-num">' + (i + 1) + '</span>' + qart +
        '<div class="t-info"><div class="t-title">' + esc(t.title) + '</div>' +
        '<div class="t-sub">' + esc(t.artist) + (t.duration ? ' · ' + fmtTime(t.duration) : '') + '</div></div>';
      div.addEventListener('click', () => { qi = i; loadCurrent(true); });
      const del = document.createElement('button');
      del.className = 'btn-small'; del.innerHTML = icon('close');
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
    waveNp.redraw();
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
  /* (Equalizer dihapus di v1.3 — butuh Web Audio, yang mematikan pemutaran latar belakang.) */

  /* ---------- search / browse ---------- */
  /* Genre di Beranda — hanya genre Indonesia (v1.6: semua genre Archive luar dihapus). */
  const GENRES = [
    { label: 'Pop Indo', q: 'pop indonesia' },
    { label: 'Dangdut', q: 'dangdut' }, { label: 'Reggae Indo', q: 'reggae indonesia' },
    { label: 'Gamelan', q: 'gamelan' }
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

  /* ---------- SoundCloud: cari & putar ---------- */
  const SC_CHIPS = [
    { label: 'Trending TikTok', q: 'tiktok viral' },
    { label: 'Trending IG', q: 'instagram reels viral' },
    { label: 'Dangdut', q: 'dangdut' },
    { label: 'Pop Indo', q: 'pop indonesia' },
    { label: 'Reggae Indo', q: 'reggae indonesia' }
  ];
  SC_CHIPS.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = c.label;
    b.addEventListener('click', () => {
      $('#scSearchInput').value = c.q;
      runSoundCloudSearch(c.q);
    });
    $('#scChips').appendChild(b);
  });
  function runSoundCloudSearch(query) {
    const st = $('#scStatus'), box = $('#scResults');
    st.textContent = 'Mencari di SoundCloud…';
    box.innerHTML = '';
    soundcloudSearch(query, 20).then((tracks) => {
      if (!tracks.length) { st.textContent = 'Tidak ditemukan di SoundCloud untuk "' + query + '". Coba kata kunci lain.'; return; }
      st.textContent = tracks.length + ' lagu ditemukan di SoundCloud — ketuk untuk memutar.';
      tracks.forEach((t, i) => box.appendChild(trackRow(t, tracks, i)));
      markPlayingRow();
    }).catch(() => {
      st.textContent = 'SoundCloud tidak bisa dijangkau sekarang. Periksa koneksi internet lalu coba lagi, atau cari lewat Internet Archive.';
    });
  }
  $('#scSearchBtn').addEventListener('click', () => {
    const q = $('#scSearchInput').value.trim();
    if (q) runSoundCloudSearch(q);
  });
  $('#scSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const q = e.target.value.trim(); if (q) runSoundCloudSearch(q); } });

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
    if (name === 'beranda') { closeCollection(); renderHomeRecent(); }
  }
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  /* ---------- featured (verified full tracks, Indonesia) + beranda ---------- */
  const FEATURED = ['TopLaguPopTerbaru', 'KumpulanLaguPopIndonesia', 'LaguPopLawasTerbaik'];
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
        ? '<div class="feat-art" style="background:' + coverGradient(t.title) + '"><img src="' + esc(thumb) + '" alt="" onerror="this.remove()"></div>'
        : '<div class="feat-art" style="background:' + coverGradient(t.title) + '">' + icon('note') + '</div>';
      card.innerHTML = artHtml +
        '<div class="feat-title">' + esc(t.title) + '</div>' +
        '<div class="feat-artist">' + esc(t.artist) + '</div>';
      card.addEventListener('click', () => playAt(tracks, i));
      row.appendChild(card);
    });
  }

  /* ---------- Koleksi Pilihan (Indo, Indie Indo Kekinian, Trending Luar) ----------
     Kompilasi lagu Indonesia dari Internet Archive, plus koleksi Indie Indo
     dari akun SoundCloud resmi tiap band (scUser) dan koleksi workaround via
     pencarian SoundCloud (scSearch). Lagu luar HANYA yang sedang trend di
     TikTok/Instagram dan koleksi artis luar — semuanya via SoundCloud, bukan Archive.
     Kartu koleksi → daftar lagu → ketuk untuk memutar (player & antrean yang sama). */
  const COLLECTION_GROUPS = [
    { group: '🇮🇩 Pop Indo', cols: [
      { id: 'juicy-luicy-h-5', name: 'Juicy Luicy — H-5', desc: 'Juicy Luicy' },
      { id: 'juicy-luicy-adrian-khalif-feat.-mahalini-sialan-live-performance-256-kbps', name: 'Juicy Luicy & Adrian Khalif feat. Mahalini — Sialan (Live)', desc: 'Juicy Luicy' },
      { id: 'TopLaguPopTerbaru', name: 'Top Lagu Pop Terbaru', desc: '51 lagu pop Indo' },
      { id: 'KumpulanLaguPopIndonesia', name: 'Kumpulan Lagu Pop Indonesia', desc: '96 lagu pop Indo' },
      { id: 'LaguPopLawasTerbaik', name: 'Lagu Pop Lawas Terbaik', desc: '37 lagu pop lawas' }
    ] },
    { group: '🎸 Pop Punk / Skate Punk Indo', cols: [
      { id: 'AlbumSoekamtiCom2010', name: 'Endank Soekamti — Album 2010', desc: '15 lagu · Endank Soekamti' },
      { id: 'AlbumKOLABORASOE', name: 'Endank Soekamti — KOLABORASOE', desc: '16 lagu · Endank Soekamti' },
      { id: 'superglad-hari-hura-hura', name: 'Superglad — Hari Hura Hura', desc: '10 lagu · Superglad' },
      { id: 'cewek-matrepolis', name: 'Superglad — Cewek Matrepolis', desc: '4 lagu · Superglad' },
      { id: 'PeeWeeGaskinsAmukRedam', name: 'Pee Wee Gaskins — Amuk Redam', desc: 'Pee Wee Gaskins' },
      { id: 'peeweegaskinssampaijuara', name: 'Pee Wee Gaskins — Sampai Juara', desc: 'Pee Wee Gaskins' }
    ] },
    { group: '🎺 Ska Indo', cols: [
      { id: 'tipe-x-festifal-perasaan', name: 'Tipe-X — Festifal Perasaan', desc: '10 lagu ska Indo' },
      { id: 'discography-hitam-putih', name: 'Tipe-X — Hitam Putih', desc: '10 lagu ska Indo' }
    ] },
    { group: '🌴 Reggae Indo', cols: [
      { id: 'LaguTonyQRastafara', name: 'Tony Q Rastafara', desc: '32 lagu reggae' },
      { id: '3.-steven-coconut-treez-bebas-merdeka', name: 'Steven & Coconut Treez — Bebas Merdeka', desc: 'Steven & Coconut Treez' },
      { id: 'TopSongRegeSka', name: 'Top Song Rege Ska', desc: '7 lagu rege/ska Indo' },
      { id: 'LaguReggae', name: 'Lagu Reggae', desc: '259 lagu reggae' }
    ] },
    { group: '🎵 Indie Indo Kekinian', cols: [
      { id: 'sc-user-896154106', name: 'Perunggu — Koleksi Lengkap', desc: '28 lagu · Memorandum, Dalam Dinamika, Pendar', scUser: 896154106 },
      { id: 'sc-user-41827465', name: 'Fourtwnty — Koleksi', desc: '14 lagu · Fana Merah Jambu, Aku Tenang, Hitam Putih', scUser: 41827465 },
      { id: 'sc-user-1625261899', name: 'Hindia — Koleksi', desc: '15 lagu · Evaluasi, Secukupnya, Rumah ke Rumah', scUser: 1625261899 },
      { id: 'sc-user-23854857', name: 'Threesixty — Koleksi', desc: '4 lagu · Dewi, Sampai Nanti, Tak Akan Bisa', scUser: 23854857 },
      { id: 'sc-user-172584548', name: 'The Jansen — Demo & Awal', desc: '8 lagu awal · Alienasi, Bring Me Back to the 70’s', scUser: 172584548 },
      { id: 'sc-user-523658790', name: '.Feast — Koleksi', desc: '7 lagu · Dalam Hitungan, Kelelawar, Peradaban', scUser: 523658790 },
      { id: 'sc-user-15090252', name: 'Danilla — Koleksi', desc: '15 lagu · Ada di Sana, Terpaut Oleh Waktu + cover', scUser: 15090252 },
      { id: 'sc-user-23223418', name: 'For Revenge — Koleksi', desc: '5 lagu · Second Chance, Sendiri, Termentahkan', scUser: 23223418 },
      { id: 'sc-user-24112892', name: 'FSTVLST — Koleksi', desc: '9 lagu · Telan Cakrawalanya, Jenny Menarilah', scUser: 24112892 }
    ] },
    /* v1.5 — workaround untuk lagu Indo trending yang tidak ada di akun resmi
       (Barasuara hanya punya preview 30 detik, Nadin Amizah tanpa akun resmi,
       album penuh The Jansen/Threesixty tidak di akun resmi, .Feast Tarot/Nina
       hanya re-upload penggemar). Koleksi ini mencari SoundCloud saat dibuka dan
       memutar hasil pencarian — termasuk unggahan komunitas (terverifikasi playable
       2026-11-27: tiap pencarian mengembalikan lagu penuh + stream .m3u8 HTTP 200).
       Dijaga jujur di UI dengan label "via SoundCloud". */
    { group: '🎵 Indie Indo — via SoundCloud', cols: [
      { id: 'sc-search-barasuara', name: 'Barasuara — Koleksi', desc: 'via SoundCloud · Terbuang Dalam Waktu, Pancarona', scSearch: 'Barasuara', viaSC: true },
      { id: 'sc-search-nadin-amizah', name: 'Nadin Amizah — Koleksi', desc: 'via SoundCloud · Bertaut, Sorai, Taruh', scSearch: 'Nadin Amizah', viaSC: true },
      { id: 'sc-search-the-jansen', name: 'The Jansen — Koleksi Lengkap', desc: 'via SoundCloud · termasuk full album 2023', scSearch: 'The Jansen', viaSC: true },
      { id: 'sc-search-threesixty', name: 'Threesixty — Koleksi Lengkap', desc: 'via SoundCloud · Dewi, Sampai Nanti, Tak Akan Bisa', scSearch: 'Threesixty', viaSC: true },
      { id: 'sc-search-feast-tarot', name: '.Feast — Tarot', desc: 'via SoundCloud · Tarot', scSearch: 'Feast Tarot', viaSC: true },
      { id: 'sc-search-feast-nina', name: '.Feast — Nina', desc: 'via SoundCloud · Nina', scSearch: 'Feast Nina', viaSC: true }
    ] },
    /* v1.6 — lagu luar yang sedang trend di TikTok/Instagram (Nov 2026) + koleksi
       artis luar. SEMUA via SoundCloud (bukan Archive). Koleksi trending memakai
       daftar ID track yang sudah terverifikasi satu per satu saat build
       (pencarian mengembalikan upload lagu penuh + stream ter-resolve HTTP 200);
       koleksi artis memakai pencarian SoundCloud dinamis (scSearch). Lagu-lagu ini
       adalah unggahan komunitas/remix — ditandai "via SoundCloud" di UI.
       Catatan verifikasi: query "My Chemical Romance" hanya mengembalikan track
       HLS terenkripsi (tidak bisa diputar aplikasi) — koleksi MCR memakai query
       "MCR"; query "Djo" didominasi artis Prancis "Mauvais Djo" — koleksi Djo
       memakai query "Djo Joe Keery". */
    { group: '🔥 Trending TikTok', cols: [
      { id: 'sc-trending-tiktok', name: 'Trending TikTok — Nov 2026', desc: 'via SoundCloud · 18 lagu luar yang lagi viral di TikTok', scTracks: [2433571311, 2441334870, 2420080329, 6736771, 2129562687, 1937424026, 2061241564, 2058172076, 1964746283, 2416558491, 224549764, 2426518062, 183043927, 2445146406, 230947125, 2160643491, 2408342127, 2042648552], viaSC: true }
    ] },
    { group: '📸 Trending Instagram', cols: [
      { id: 'sc-trending-ig', name: 'Trending Instagram — Nov 2026', desc: 'via SoundCloud · 18 lagu luar yang lagi viral di Reels', scTracks: [1960063299, 2307966296, 1103041795, 2441758293, 2337663461, 2383817022, 513864354, 2030907064, 2424709509, 62682267, 124822516, 418803480, 2012875331, 2439986583, 2441837925, 2409419199, 2433571311, 1237165465], viaSC: true }
    ] },
    { group: '🎤 Artis Luar — via SoundCloud', cols: [
      { id: 'sc-search-billie-eilish', name: 'Billie Eilish — Koleksi', desc: 'via SoundCloud · Ocean Eyes, Six Feet Under, bitches broken hearts', scSearch: 'Billie Eilish', viaSC: true },
      { id: 'sc-search-avenged-sevenfold', name: 'Avenged Sevenfold — Koleksi', desc: 'via SoundCloud · Gunslinger, So Far Away, Dear God', scSearch: 'Avenged Sevenfold', viaSC: true },
      { id: 'sc-search-djo', name: 'Djo — Koleksi', desc: 'via SoundCloud · End of Beginning, Chateau, Flash Mountain', scSearch: 'Djo Joe Keery', viaSC: true },
      { id: 'sc-search-mcr', name: 'My Chemical Romance — Koleksi', desc: 'via SoundCloud · Welcome to the Black Parade, Helena, Teenagers', scSearch: 'MCR', viaSC: true },
      { id: 'sc-search-bmth', name: 'Bring Me The Horizon — Koleksi', desc: 'via SoundCloud · Sleepwalking, Can You Feel My Heart, Throne', scSearch: 'Bring Me The Horizon', viaSC: true }
    ] }
  ];
  const COLLECTION_CACHE_TTL = 7 * 24 * 3600 * 1000; // 7 hari
  function getCollectionCache() { return store.get('musikku_collections', {}); }
  function setCollectionCache(c) { store.set('musikku_collections', c); }
  /* Muat daftar lagu satu koleksi; utamakan .mp3 dan buang duplikat .ogg dari lagu yang sama.
     Koleksi SoundCloud (scUser) dimuat dari akun resmi artis via soundcloudUserTracks. */
  function loadCollectionTracks(identifier) {
    const cache = getCollectionCache();
    const hit = cache[identifier];
    if (hit && hit.at && (Date.now() - hit.at) < COLLECTION_CACHE_TTL && hit.tracks && hit.tracks.length) {
      return Promise.resolve(hit.tracks);
    }
    let col = null;
    COLLECTION_GROUPS.forEach((g) => g.cols.forEach((c) => { if (c.id === identifier) col = c; }));
    const loader = (col && col.scTracks)
      ? soundcloudTracksByIds(col.scTracks)
      : (col && col.scUser)
        ? soundcloudUserTracks(col.scUser, 50)
        : (col && col.scSearch)
          ? soundcloudSearch(col.scSearch, 50)
          : archiveItemTracks(identifier);
    return loader.then((tracks) => {
      const byTitle = {};
      tracks.forEach((t) => {
        const key = (t.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const prev = byTitle[key];
        const rank = (u) => (u && u.toLowerCase().indexOf('.mp3') !== -1 ? 0 : u && u.toLowerCase().indexOf('.m4a') !== -1 ? 1 : 2);
        if (!prev || rank(t.url) < rank(prev.url)) byTitle[key] = t;
      });
      const deduped = Object.values(byTitle);
      cache[identifier] = { at: Date.now(), tracks: deduped };
      setCollectionCache(cache);
      return deduped;
    });
  }
  /* ---------- foto sampul kartu koleksi (v1.5) ----------
     Archive → thumbnail asli item (services/img). SoundCloud → foto artis (avatar akun)
     atau sampul lagu pertama bila avatar memakai gambar default. Hasil dicache. */
  const scArtCache = {};
  function collectionArtUrl(col) {
    if (col.scUser || col.scSearch || col.scTracks) return null; // dimuat async (butuh API SoundCloud)
    return 'https://archive.org/services/img/' + encodeURIComponent(col.id);
  }
  function loadCollectionCardArt(col, artEl) {
    if (!col.scUser && !col.scSearch && !col.scTracks) return;
    const apply = (url) => {
      if (!url || !artEl.isConnected) return;
      artEl.innerHTML = '<img src="' + esc(url) + '" alt="" onerror="this.remove()">' +
        (col.viaSC ? '<span class="via-tag">via SoundCloud</span>' : '');
    };
    if (scArtCache[col.id]) { apply(scArtCache[col.id]); return; }
    if (col.scUser) {
      scGetJson(SC_API + '/users/' + col.scUser + '?client_id=' + SC_CLIENT_ID).then((d) => {
        let av = d && d.avatar_url ? String(d.avatar_url).replace('-large.', '-t500x500.').replace('-large.jpg', '-t500x500.jpg') : '';
        if (!av || av.indexOf('default_avatar') !== -1) {
          return soundcloudUserTracks(col.scUser, 5).then((tr) => {
            const first = tr.find((x) => x.artwork);
            if (first) { scArtCache[col.id] = first.artwork; apply(first.artwork); }
          }).catch(() => {});
        }
        scArtCache[col.id] = av; apply(av);
      }).catch(() => {});
    } else if (col.scSearch) {
      soundcloudSearch(col.scSearch, 5).then((tr) => {
        const first = tr.find((x) => x.artwork);
        if (first) { scArtCache[col.id] = first.artwork; apply(first.artwork); }
      }).catch(() => {});
    } else if (col.scTracks) {
      soundcloudTracksByIds(col.scTracks).then((tr) => {
        const first = tr.find((x) => x.artwork);
        if (first) { scArtCache[col.id] = first.artwork; apply(first.artwork); }
      }).catch(() => {});
    }
  }
  function renderCollections() {
    const box = $('#collectionsHome');
    if (!box) return;
    box.innerHTML = '';
    COLLECTION_GROUPS.forEach((g) => {
      const title = document.createElement('h3');
      title.className = 'collection-group-title';
      title.textContent = g.group;
      box.appendChild(title);
      const row = document.createElement('div');
      row.className = 'featured-row';
      g.cols.forEach((c) => {
        const card = document.createElement('div');
        card.className = 'featured-card collection-card';
        const artUrl = collectionArtUrl(c);
        const viaTag = c.viaSC ? '<span class="via-tag">via SoundCloud</span>' : '';
        const artHtml = artUrl
          ? '<div class="feat-art" style="background:' + coverGradient(c.name) + '"><img src="' + esc(artUrl) + '" alt="" onerror="this.remove()">' + viaTag + '</div>'
          : '<div class="feat-art" style="background:' + coverGradient(c.name) + '">' + icon('note') + viaTag + '</div>';
        card.innerHTML = artHtml +
          '<div class="feat-title">' + esc(c.name) + '</div>' +
          '<div class="feat-artist">' + esc(c.desc) + ' · ketuk untuk buka</div>';
        card.addEventListener('click', () => openCollection(c));
        row.appendChild(card);
        if (!artUrl) loadCollectionCardArt(c, card.querySelector('.feat-art'));
      });
      box.appendChild(row);
    });
  }
  let openCollectionId = null;
  function openCollection(col) {
    openCollectionId = col.id;
    $('#berandaHome').hidden = true;
    const detail = $('#collectionDetail');
    detail.hidden = false;
    $('#collectionDetailName').textContent = col.name;
    const hero = $('#collectionDetailArt');
    if (hero) {
      const artUrl = collectionArtUrl(col);
      hero.style.background = coverGradient(col.name);
      hero.innerHTML = artUrl
        ? '<img src="' + esc(artUrl) + '" alt="" onerror="this.remove()">'
        : icon('note');
      if (!artUrl) loadCollectionCardArt(col, hero);
    }
    const st = $('#collectionDetailStatus');
    st.textContent = 'Memuat lagu…';
    const box = $('#collectionDetailList');
    box.innerHTML = '';
    loadCollectionTracks(col.id).then((tracks) => {
      if (openCollectionId !== col.id) return;
      if (!tracks.length) { st.textContent = 'Tidak ada lagu di koleksi ini (mungkin sudah dihapus dari arsip).'; return; }
      st.textContent = tracks.length + ' lagu — ketuk untuk memutar.' +
        (col.viaSC ? ' Koleksi via SoundCloud (unggahan komunitas — bisa berubah sewaktu-waktu).' : '');
      tracks.forEach((t, i) => box.appendChild(trackRow(t, tracks, i)));
      markPlayingRow();
    }).catch(() => {
      if (openCollectionId !== col.id) return;
      st.textContent = 'Gagal memuat koleksi. Periksa internet lalu coba lagi.';
    });
  }
  function closeCollection() {
    openCollectionId = null;
    const detail = $('#collectionDetail');
    if (detail) detail.hidden = true;
    const home = $('#berandaHome');
    if (home) home.hidden = false;
  }
  $('#backToCollections').addEventListener('click', closeCollection);

  /* ---------- tema ---------- */
  $('#themeToggle').addEventListener('click', toggleTheme);

  /* ---------- hero trending (v1.7, gaya mockup Apple Music) ---------- */
  const hero = $('#trendingHero');
  if (hero) {
    const openTrending = () => {
      let col = null;
      COLLECTION_GROUPS.forEach((g) => g.cols.forEach((c) => { if (c.id === 'sc-trending-tiktok') col = c; }));
      if (col) openCollection(col);
    };
    hero.addEventListener('click', openTrending);
    hero.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTrending(); } });
  }

  /* ---------- service worker ---------- */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  /* ---------- init ---------- */
  applyTheme();
  setupMediaSessionHandlers();
  refreshDownloadedIds().then(() => { renderDownloads(); renderMyFiles(); });
  renderFavs();
  renderPlaylists();
  renderRecent();
  renderHomeRecent();
  renderCollections();
  loadFeatured();
})();
