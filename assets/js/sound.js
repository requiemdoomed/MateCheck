/*
 * MateCheck - sound
 * Copyright (c) 2026 Swayam Shakya. MIT License.
 *
 * Music: MP3 cues rendered by MateCheck.ipynb, decoded with the Web Audio API
 * and looped sample-accurately (the encoder's 1105-sample lead-in is skipped).
 * Over http(s) the MP3 files are fetched; opened straight from disk (file://)
 * browsers block fetch, so a base64 sound bank is loaded instead.
 *
 * Effects: synthesized live with oscillators and noise. No files needed.
 */
(function (root) {
  'use strict';

  var manifest = root.MateCheckAudioManifest || { rate: 44100, delay: 1105, tracks: {} };
  var BASE = 'assets/audio/';
  var store = (function () {
    try { var k = '__mc'; root.localStorage.setItem(k, '1'); root.localStorage.removeItem(k); return root.localStorage; } catch (e) { return null; }
  }());

  function readPref(key, fallback) {
    if (!store) return fallback;
    try { var v = store.getItem('matecheck.' + key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  }
  function writePref(key, value) {
    if (!store) return;
    try { store.setItem('matecheck.' + key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
  }

  var ctx = null, master = null, musicBus = null, sfxBus = null, duckGain = null, noiseBuf = null;
  var prefs = {
    music: readPref('musicVol', 0.7),
    sfx: readPref('sfxVol', 0.8),
    muted: readPref('muted', false)
  };
  var decoded = {};        // name -> Promise<AudioBuffer>
  var lru = [];            // recently used music, so memory stays reasonable on phones
  var current = null;      // { name, src, gain }
  var playlistTimer = null;
  var bankPromise = null;
  var listeners = [];
  var wantMusic = null;    // remembered while the context is still locked

  function supported() { return !!(root.AudioContext || root.webkitAudioContext); }

  function ensure() {
    if (ctx || !supported()) return ctx;
    var AC = root.AudioContext || root.webkitAudioContext;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
    master = ctx.createGain();
    master.gain.value = prefs.muted ? 0 : 1;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = prefs.music * 0.9;
    duckGain = ctx.createGain(); duckGain.gain.value = 1;
    musicBus.connect(duckGain); duckGain.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = prefs.sfx;
    sfxBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // whenever the browser lets the sound through, start whatever was asked for meanwhile
    ctx.onstatechange = function () {
      if (ctx.state === 'running' && wantMusic) { var w = wantMusic; wantMusic = null; music(w.name, w.opts); }
      emit('state', state());
    };
    return ctx;
  }

  // 'running', 'locked' (waiting for the browser's permission) or 'unsupported'
  function state() {
    if (!supported()) return 'unsupported';
    if (!ctx) return 'locked';
    return ctx.state === 'running' ? 'running' : 'locked';
  }

  // Browsers only allow sound once the page has been touched, unless they already trust the
  // site (Chrome and Edge remember sites where you played sound before, Firefox and Safari
  // have a per-site autoplay setting). So: try right away, and if the browser says not yet,
  // keep listening for the very first click, tap or key press anywhere and start then.
  function autoplayAllowed() {
    try {
      if (navigator.getAutoplayPolicy) return navigator.getAutoplayPolicy('audiocontext') === 'allowed';
    } catch (e) { /* older browsers */ }
    return null;   // unknown: just try
  }

  function unlock() {
    if (!ensure()) return Promise.resolve();
    var p = ctx.state !== 'running' ? ctx.resume() : Promise.resolve();
    return p.then(function () {
      if (ctx.state === 'running' && wantMusic) { var w = wantMusic; wantMusic = null; music(w.name, w.opts); }
    }, function () {});
  }

  var GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'];
  var listening = false;
  function onGesture() {
    unlock().then(function () {
      if (ctx && ctx.state === 'running') stopListening();
    });
  }
  function stopListening() {
    if (!listening) return;
    listening = false;
    GESTURES.forEach(function (g) { document.removeEventListener(g, onGesture, true); });
  }
  function listen() {
    if (listening || typeof document === 'undefined') return;
    listening = true;
    GESTURES.forEach(function (g) { document.addEventListener(g, onGesture, true); });
  }

  // Ask the browser, without making a fuss, whether sound may start before a click: play a
  // hundredth of a second of silence. Browsers without getAutoplayPolicy answer this way.
  var SILENCE = 'data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';
  function probeAutoplay() {
    var policy = autoplayAllowed();
    if (policy !== null) return Promise.resolve(policy);
    return new Promise(function (resolve) {
      try {
        var a = new Audio(SILENCE);
        var p = a.play();
        if (p && typeof p.then === 'function') p.then(function () { a.pause(); resolve(true); }, function () { resolve(false); });
        else resolve(false);
      } catch (e) { resolve(false); }
    });
  }

  // called once when the page opens: fetch the first cue, then play it as soon as allowed
  function autostart(name, opts) {
    if (!supported()) return;
    prefetch([name]);
    listen();
    wantMusic = { name: name, opts: opts || {} };
    probeAutoplay().then(function (ok) { if (ok && wantMusic) unlock(); });
  }

  // ---- loading -------------------------------------------------------------------
  function loadBank() {
    if (root.MateCheckSoundBank) return Promise.resolve(root.MateCheckSoundBank);
    if (bankPromise) return bankPromise;
    bankPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = BASE + 'soundbank.js';
      s.async = true;
      s.onload = function () { root.MateCheckSoundBank ? resolve(root.MateCheckSoundBank) : reject(new Error('sound bank empty')); };
      s.onerror = function () { reject(new Error('sound bank missing')); };
      document.head.appendChild(s);
    });
    return bankPromise;
  }

  function b64ToBuffer(b64) {
    var bin = atob(b64), n = bin.length, bytes = new Uint8Array(n);
    for (var i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function fetchBytes(name) {
    var url = BASE + name + '.mp3';
    if (location.protocol === 'file:' || typeof fetch !== 'function') {
      return loadBank().then(function (bank) {
        if (!bank[name]) throw new Error('no ' + name + ' in bank');
        return b64ToBuffer(bank[name]);
      });
    }
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(r.status + ' ' + url);
      return r.arrayBuffer();
    }).catch(function () {
      return loadBank().then(function (bank) { return b64ToBuffer(bank[name]); });
    });
  }

  function decode(ab) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var p = ctx.decodeAudioData(ab, function (buf) { if (!done) { done = true; resolve(buf); } }, function (e) { if (!done) { done = true; reject(e); } });
      if (p && typeof p.then === 'function') p.then(function (buf) { if (!done) { done = true; resolve(buf); } }, function (e) { if (!done) { done = true; reject(e); } });
    });
  }

  // download (but don't decode) cues ahead of time: needs no audio context, so it can
  // happen before the browser allows sound, and the first note plays without a wait
  var raw = {};
  function prefetch(names) {
    names.forEach(function (n) {
      if (raw[n] || decoded[n]) return;
      raw[n] = fetchBytes(n);
      raw[n].catch(function () { delete raw[n]; });
    });
  }

  function load(name) {
    if (!ensure()) return Promise.reject(new Error('no audio'));
    if (!decoded[name]) {
      var bytes = raw[name] || fetchBytes(name);
      delete raw[name];
      decoded[name] = bytes.then(decode);
      decoded[name].catch(function () { delete decoded[name]; });
    }
    touch(name);
    return decoded[name];
  }

  function touch(name) {
    var meta = manifest.tracks[name];
    if (!meta || !meta.loop) return;
    var i = lru.indexOf(name);
    if (i >= 0) lru.splice(i, 1);
    lru.push(name);
    while (lru.length > 4) {
      var old = lru.shift();
      if (current && current.name === old) { lru.push(old); break; }
      delete decoded[old];
    }
  }

  // loop window inside a decoded buffer, skipping the MP3 lead-in
  function loopWindow(name, buf) {
    var meta = manifest.tracks[name] || {};
    var trueDur = meta.samples ? meta.samples / manifest.rate : buf.duration;
    var lead = manifest.delay / manifest.rate;
    var extra = buf.duration - trueDur;
    if (extra < 0.005) lead = 0;
    else if (extra < lead) lead = extra;
    return { start: lead, end: Math.min(buf.duration, lead + trueDur) };
  }

  // ---- music --------------------------------------------------------------------------
  function music(name, opts) {
    opts = opts || {};
    if (!supported()) return Promise.resolve();
    if (!ctx) { wantMusic = { name: name, opts: opts }; prefetch([name]); return Promise.resolve(); }   // no sound allowed yet
    if (ctx.state !== 'running') {
      // not allowed to sound yet: remember the request and get the cue decoded meanwhile
      wantMusic = { name: name, opts: opts };
      load(name).catch(function () {});
      return Promise.resolve();
    }
    if (current && current.name === name && !opts.restart) return Promise.resolve();
    var fade = opts.fade == null ? 1.6 : opts.fade;
    var token = {};
    music.token = token;
    return load(name).then(function (buf) {
      if (music.token !== token) return;               // somebody asked for another track meanwhile
      var win = loopWindow(name, buf);
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var meta = manifest.tracks[name] || {};
      src.loop = meta.loop !== false;
      src.loopStart = win.start;
      src.loopEnd = win.end;
      var g = ctx.createGain();
      var now = ctx.currentTime;
      var target = (meta.gain || 1) * (opts.gain || 1);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(target, now + Math.max(0.05, fade));
      src.connect(g); g.connect(musicBus);
      src.start(now, win.start);
      stopCurrent(fade);
      current = { name: name, src: src, gain: g };
      emit('music', name);
    }).catch(function (e) { if (root.console) console.warn('[sound] ' + name + ': ' + e.message); });
  }

  function stopCurrent(fade) {
    if (!current) return;
    var c = current;
    current = null;
    var now = ctx.currentTime;
    try {
      c.gain.gain.cancelScheduledValues(now);
      c.gain.gain.setValueAtTime(Math.max(0.0001, c.gain.gain.value), now);
      c.gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.05, fade));
      c.src.stop(now + Math.max(0.05, fade) + 0.05);
    } catch (e) { /* already stopped */ }
  }

  function stopMusic(fade) {
    stopPlaylist();
    wantMusic = null;
    music.token = {};
    if (ctx) stopCurrent(fade == null ? 1.2 : fade);
  }

  // ---- the journey: gameplay music that keeps travelling ---------------------------------------
  // Each exploration track plays for about a minute, then the next one crossfades in. The order is
  // shuffled, never repeats back to back, and a tense moment can cut to a battle cue and back.
  var journey = null;
  function trackSecs(name) {
    var meta = manifest.tracks[name];
    return meta && meta.samples ? meta.samples / manifest.rate : 45;
  }
  function shuffled(list, avoidFirst) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    if (a.length > 1 && a[0] === avoidFirst) { a.push(a.shift()); }
    return a;
  }
  function journeyNext() {
    var j = journey;
    if (!j || j.tense) return;
    if (j.i >= j.order.length) { j.order = shuffled(j.names, j.last); j.i = 0; }
    var name = j.order[j.i++];
    j.last = name;
    music(name, { fade: j.first ? 2.5 : 4 });
    j.first = false;
    var secs = trackSecs(name);
    var stay = secs * Math.max(1, Math.round(j.stay / secs));
    playlistTimer = setTimeout(journeyNext, Math.max(20, stay - 2) * 1000);
  }
  function playlist(names, opts) {
    stopPlaylist();
    opts = opts || {};
    journey = { names: names.slice(), order: shuffled(names, null), i: 0, last: null, tense: null, battle: opts.battle || null, stay: opts.stay || 60, first: true };
    journeyNext();
  }
  // switch the journey into (or out of) its battle cue
  function setTension(on) {
    var j = journey;
    if (!j || !j.battle || !!j.tense === !!on) return;
    if (on) {
      if (playlistTimer) { clearTimeout(playlistTimer); playlistTimer = null; }
      j.tense = true;
      music(j.battle, { fade: 1.4 });
    } else {
      j.tense = null;
      journeyNext();
    }
  }
  function stopPlaylist() { if (playlistTimer) { clearTimeout(playlistTimer); playlistTimer = null; } journey = null; }

  // one-shot musical cue (stingers), with the music ducked underneath
  function sting(name, opts) {
    opts = opts || {};
    if (!supported() || !ctx) return Promise.resolve(0);
    return load(name).then(function (buf) {
      var win = loopWindow(name, buf);
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var g = ctx.createGain();
      g.gain.value = opts.gain || 1;
      src.connect(g); g.connect(sfxBus);
      var now = ctx.currentTime;
      src.start(now, win.start, win.end - win.start);
      var duck = opts.duck == null ? 0.35 : opts.duck;
      var len = win.end - win.start;
      duckGain.gain.cancelScheduledValues(now);
      duckGain.gain.setValueAtTime(duckGain.gain.value, now);
      duckGain.gain.linearRampToValueAtTime(duck, now + 0.25);
      duckGain.gain.setValueAtTime(duck, now + Math.max(0.3, len - 1.5));
      duckGain.gain.linearRampToValueAtTime(1, now + len + 0.5);
      return len;
    }).catch(function () { return 0; });
  }

  function preload(names) {
    if (!supported()) return;
    if (!ctx) { prefetch(names); return; }
    names.forEach(function (n) { load(n).catch(function () {}); });
  }

  // ---- synthesized effects -------------------------------------------------------------
  function env(g, t, a, peak, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + decay);
  }

  function tone(type, freq, t, a, peak, decay, dest, glideTo) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + a + decay);
    env(g, t, a, peak, decay);
    o.connect(g); g.connect(dest || sfxBus);
    o.start(t); o.stop(t + a + decay + 0.05);
  }

  function noiseHit(t, dur, peak, type, freq, q, dest, sweepTo) {
    var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf;
    f.type = type || 'bandpass';
    f.frequency.setValueAtTime(freq || 1200, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q || 1;
    env(g, t, Math.min(0.01, dur / 4), peak, dur);
    s.connect(f); f.connect(g); g.connect(dest || sfxBus);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  var SFX = {
    move: function (t) {
      noiseHit(t, 0.09, 0.5, 'bandpass', 1400, 2.5);
      tone('sine', 240, t, 0.004, 0.35, 0.12, null, 150);
    },
    rally: function (t) {
      [783.99, 987.77, 1318.5].forEach(function (f, i) { tone('triangle', f, t + i * 0.06, 0.01, 0.16, 0.5); });
      noiseHit(t, 0.5, 0.06, 'highpass', 5000, 0.7, null, 9000);
    },
    seal: function (t) {
      tone('sine', 880, t, 0.005, 0.22, 1.4);
      tone('sine', 1318.5, t, 0.005, 0.12, 1.1);
      tone('sine', 2637, t + 0.01, 0.005, 0.05, 0.6);
      tone('sine', 110, t, 0.005, 0.3, 0.25, null, 70);
    },
    banish: function (t) {
      tone('sawtooth', 620, t, 0.01, 0.12, 0.45, null, 70);
      noiseHit(t, 0.45, 0.25, 'bandpass', 3000, 0.8, null, 200);
    },
    check: function (t) {
      tone('square', 880, t, 0.005, 0.09, 0.12);
      tone('square', 660, t + 0.14, 0.005, 0.09, 0.18);
    },
    recall: function (t) {
      noiseHit(t, 0.35, 0.18, 'bandpass', 400, 1.2, null, 4000);
      tone('triangle', 1046.5, t + 0.05, 0.02, 0.1, 0.3, null, 523);
    },
    select: function (t) { tone('sine', 1250, t, 0.002, 0.08, 0.06); },
    invalid: function (t) { tone('square', 120, t, 0.005, 0.08, 0.16, null, 90); },
    click: function (t) { tone('triangle', 900, t, 0.002, 0.07, 0.05); },
    turn: function (t) { tone('sine', 1046.5, t, 0.01, 0.07, 0.25); tone('sine', 1568, t + 0.08, 0.01, 0.05, 0.3); },
    tick: function (t) { noiseHit(t, 0.012, 0.05, 'highpass', 6000, 0.7); },
    whoosh: function (t) { noiseHit(t, 1.2, 0.3, 'bandpass', 200, 0.9, null, 2400); },
    thunder: function (t) {
      noiseHit(t, 2.6, 0.7, 'lowpass', 300, 0.7, null, 60);
      noiseHit(t + 0.05, 0.3, 0.4, 'highpass', 1500, 0.7);
    },
    hint: function (t) { tone('sine', 1567.98, t, 0.01, 0.06, 0.4); tone('sine', 2093, t + 0.1, 0.01, 0.05, 0.4); }
  };

  function sfx(name) {
    if (!ctx || prefs.muted || ctx.state !== 'running') return;   // effects never wake the audio up
    var f = SFX[name];
    if (f) f(ctx.currentTime + 0.005);
  }

  // ---- narrator (optional, uses the browser's own voices) -------------------------------------
  var narrator = { on: readPref('narrator', false) };
  function speak(text, style) {
    if (!narrator.on || prefs.muted || !root.speechSynthesis) return;
    try {
      var u = new SpeechSynthesisUtterance(text.replace(/[“”"]/g, ''));
      u.rate = style === 'heaven' ? 0.8 : 0.95;
      u.pitch = style === 'heaven' ? 0.6 : (style === 'king' ? 0.85 : 1);
      u.volume = 0.9;
      var voices = root.speechSynthesis.getVoices();
      var en = voices.filter(function (v) { return /^en(-|_)/i.test(v.lang); });
      if (en.length) u.voice = en.find ? (en.find(function (v) { return /UK|GB|Daniel|Google UK/i.test(v.name); }) || en[0]) : en[0];
      root.speechSynthesis.speak(u);
    } catch (e) { /* speech is a bonus, never a blocker */ }
  }
  function hush() { try { if (root.speechSynthesis) root.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }

  // ---- settings ------------------------------------------------------------------------------
  function setMusicVolume(v) {
    prefs.music = v; writePref('musicVol', v);
    if (musicBus) musicBus.gain.setTargetAtTime(v * 0.9, ctx.currentTime, 0.05);
  }
  function setSfxVolume(v) {
    prefs.sfx = v; writePref('sfxVol', v);
    if (sfxBus) sfxBus.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
  }
  function setMuted(m) {
    prefs.muted = !!m; writePref('muted', prefs.muted);
    if (master) master.gain.setTargetAtTime(prefs.muted ? 0 : 1, ctx.currentTime, 0.05);
    if (prefs.muted) hush();
    emit('muted', prefs.muted);
  }
  function setNarrator(on) { narrator.on = !!on; writePref('narrator', narrator.on); if (!on) hush(); }

  function on(fn) { listeners.push(fn); }
  function emit(type, value) { listeners.forEach(function (fn) { try { fn(type, value); } catch (e) { /* ignore */ } }); }

  // pause audio when the tab is hidden, resume when it comes back
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () {
      if (!ctx) return;
      if (document.hidden) ctx.suspend().catch(function () {});
      else ctx.resume().catch(function () {});
    });
  }

  root.MateCheckSound = {
    supported: supported,
    unlock: unlock,
    autostart: autostart,
    prefetch: prefetch,
    state: state,
    music: music,
    stopMusic: stopMusic,
    playlist: playlist,
    setTension: setTension,
    endJourney: stopPlaylist,
    sting: sting,
    sfx: sfx,
    preload: preload,
    speak: speak,
    hush: hush,
    setMusicVolume: setMusicVolume,
    setSfxVolume: setSfxVolume,
    setMuted: setMuted,
    setNarrator: setNarrator,
    prefs: prefs,
    narrator: narrator,
    current: function () { return current ? current.name : null; },
    on: on,
    readPref: readPref,
    writePref: writePref
  };
}(typeof self !== 'undefined' ? self : this));
