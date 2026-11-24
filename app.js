(function () {
  "use strict";

  // ---------- Constants ----------
  const STORAGE_KEY = "topoquiz.scores.v1";
  const NAME_KEY = "topoquiz.name";
  const MAX_WRONG = 8; // hangman parts
  const ALL_ID = "__all__";
  const TYPE_QUESTION = {
    land: "Welk land is dit?",
    stad: "Welke stad is dit?",
    water: "Welk water is dit?",
    rivier: "Welke rivier is dit?",
    gebergte: "Welk gebergte is dit?",
    gebied: "Welk gebied is dit?",
    eiland: "Welk eiland is dit?",
    staat: "Welke staat is dit?",
    woestijn: "Welke woestijn is dit?",
  };
  const ROUNDS = [
    {
      key: "mc",
      title: "Meerkeuze",
      text: "Op de kaart zie je een plek. Kies het goede antwoord uit vier mogelijkheden. Alleen je eerste keuze telt voor de score!",
    },
    {
      key: "hang",
      title: "Galgje",
      text: "Raad de naam letter voor letter (klik of typ op je toetsenbord). Bij 8 foute letters hang je. Raad je het woord op tijd? Dan is hij goed.",
    },
    {
      key: "type",
      title: "Zelf typen",
      text: "Nu wordt het echt een topotoets: typ de naam zelf. Hoofdletters en accenten (ë, é) maken niet uit, maar de spelling wel!",
    },
  ];

  // ---------- Data preparation ----------
  const TOPICS = window.TOPICS.map((t) => ({
    ...t,
    items: t.items.map(([name, type, lat, lon, opt = {}], i) => ({
      id: t.id + ":" + i,
      topicId: t.id,
      topicTitle: t.title,
      name,
      type,
      lat,
      lon,
      en: opt.en || null,
      label: opt.label || name,
      alt: opt.alt || [],
    })),
  }));
  const TOPIC_BY_ID = Object.fromEntries(TOPICS.map((t) => [t.id, t]));
  const ALL_ITEMS = TOPICS.flatMap((t) => t.items);

  // ---------- Helpers ----------
  const $ = (id) => document.getElementById(id);
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const stripAccents = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const norm = (s) => stripAccents(String(s).toLowerCase()).replace(/[^a-z0-9]/g, "");
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmtTime = (ms) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return m + ":" + String(s % 60).padStart(2, "0");
  };
  const fmtDate = (iso) => {
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
  };
  function levenshtein(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return dp[a.length][b.length];
  }
  function accepted(item) {
    return [item.name, item.label, ...item.alt].map(norm);
  }
  const storage = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        /* storage not available */
      }
    },
  };

  // ---------- Screens ----------
  const screens = ["start", "intro", "quiz", "end"];
  function show(name) {
    screens.forEach((s) => $("screen-" + s).classList.toggle("hidden", s !== name));
    $("topbar").classList.toggle("hidden", name === "start" || name === "end");
    window.scrollTo(0, 0);
    if (name === "quiz" && map) setTimeout(() => map.invalidateSize(), 30);
  }

  // ---------- Timer ----------
  const timer = {
    acc: 0,
    since: null,
    handle: null,
    start() {
      if (this.since == null) this.since = performance.now();
      if (!this.handle) this.handle = setInterval(() => ($("tb-time").textContent = fmtTime(this.elapsed())), 250);
    },
    pause() {
      if (this.since != null) this.acc += performance.now() - this.since;
      this.since = null;
    },
    reset() {
      this.acc = 0;
      this.since = null;
      clearInterval(this.handle);
      this.handle = null;
      $("tb-time").textContent = "0:00";
    },
    elapsed() {
      return this.acc + (this.since != null ? performance.now() - this.since : 0);
    },
  };

  // ---------- Map ----------
  let map = null;
  let highlightLayer = null;
  let bordersLayer = null;
  let currentBounds = null;
  const countryFeatures = {};

  function initMap() {
    if (map || !window.L) return;
    map = L.map("map", { zoomSnap: 0.25, worldCopyJump: true, attributionControl: true, minZoom: 1 });
    const tiles = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
      maxZoom: 12,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);
    let tileOk = 0;
    let tileFail = 0;
    tiles.on("tileload", () => tileOk++);
    tiles.on("tileerror", () => {
      // Without map tiles, draw solid land so the map is still readable.
      if (++tileFail === 4 && tileOk === 0 && bordersLayer) bordersLayer.setStyle({ fillColor: "#f4efe3", fillOpacity: 1 });
    });

    // Country borders from bundled world-atlas data (works even when tiles fail to load)
    if (window.topojson && window.COUNTRIES_TOPO) {
      const geo = topojson.feature(window.COUNTRIES_TOPO, window.COUNTRIES_TOPO.objects.countries);
      geo.features.forEach((f) => (countryFeatures[f.properties.name] = f));
      bordersLayer = L.geoJSON(geo, {
        interactive: false,
        style: { color: "#6b7280", weight: 0.8, fill: true, fillColor: "#f2efe9", fillOpacity: 0.15 },
      }).addTo(map);
    }
    highlightLayer = L.layerGroup().addTo(map);
    map.setView([50, 10], 4);
  }

  function topicBounds(topicId) {
    const items = TOPIC_BY_ID[topicId].items;
    return L.latLngBounds(items.map((i) => [i.lat, i.lon])).pad(0.18);
  }

  function pinIcon() {
    return L.divIcon({ className: "target-pin", html: '<span class="ring"></span><span class="dot"></span>', iconSize: [16, 16] });
  }

  function showOnMap(item) {
    if (!map) return;
    highlightLayer.clearLayers();
    let showPin = true;
    if (item.type === "land" && item.en && countryFeatures[item.en]) {
      const layer = L.geoJSON(countryFeatures[item.en], {
        interactive: false,
        style: { color: "#b45309", weight: 2, fillColor: "#ffc53d", fillOpacity: 0.55 },
      });
      highlightLayer.addLayer(layer);
      const b = layer.getBounds();
      // Large countries are clear enough on their own; small ones also get a pin.
      showPin = Math.max(b.getNorth() - b.getSouth(), b.getEast() - b.getWest()) < 2.5;
    }
    if (showPin) highlightLayer.addLayer(L.marker([item.lat, item.lon], { icon: pinIcon(), interactive: false, keyboard: false }));

    currentBounds = topicBounds(item.topicId);
    if (!currentBounds.contains([item.lat, item.lon])) currentBounds.extend([item.lat, item.lon]);
    map.invalidateSize();
    map.fitBounds(currentBounds, { animate: false });
  }

  function revealOnMap(item) {
    if (!map) return;
    L.tooltip({ permanent: true, direction: "top", offset: [0, -10], className: "answer-label" })
      .setLatLng([item.lat, item.lon])
      .setContent(esc(item.label))
      .addTo(highlightLayer);
  }

  // ---------- Quiz state ----------
  let state = null;

  function buildPool(topicId) {
    if (topicId !== ALL_ID) return TOPIC_BY_ID[topicId].items.slice();
    // De-duplicate items that occur in several topics (e.g. Italië)
    const seen = new Set();
    return ALL_ITEMS.filter((i) => {
      const k = i.type + "|" + norm(i.name);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function pickQuestions(pool, n) {
    // Draw 3*n items, distinct as long as the pool allows, and give the hangman round
    // the items with names that work well for hangman (letters, not too long).
    let drawn = [];
    while (drawn.length < n * 3) drawn = drawn.concat(shuffle(pool));
    drawn = drawn.slice(0, n * 3);
    const mc = drawn.slice(0, n);
    const rest = drawn.slice(n);
    const goodForHang = (i) => norm(i.name).length >= 4 && i.name.length <= 22;
    rest.sort((a, b) => (goodForHang(b) ? 1 : 0) - (goodForHang(a) ? 1 : 0));
    const hang = shuffle(rest.slice(0, n));
    const type = shuffle(rest.slice(n));
    return { mc, hang, type };
  }

  function startQuiz() {
    const name = $("inp-name").value.trim() || "Speler";
    const topicId = $("sel-topic").value;
    const n = Number(document.querySelector("#seg-count .on").dataset.n);
    storage.set(NAME_KEY, name);
    const pool = buildPool(topicId);
    state = {
      name,
      topicId,
      topicTitle: topicId === ALL_ID ? "Alle onderwerpen" : TOPIC_BY_ID[topicId].title,
      n,
      pool,
      questions: pickQuestions(pool, n),
      round: 0,
      q: 0,
      score: { mc: 0, hang: 0, type: 0 },
      log: [],
      current: null,
    };
    timer.reset();
    $("tb-score").textContent = "0";
    initMap();
    showIntro();
  }

  function showIntro() {
    timer.pause();
    const r = ROUNDS[state.round];
    $("intro-num").textContent = "Ronde " + (state.round + 1) + " van 3";
    $("intro-title").textContent = r.title;
    $("intro-text").textContent = r.text;
    $("tb-round").textContent = "Ronde " + (state.round + 1) + ": " + r.title;
    show("intro");
    $("btn-intro-go").focus();
  }

  function beginRound() {
    state.q = 0;
    show("quiz");
    timer.start();
    nextQuestion();
  }

  function nextQuestion() {
    const r = ROUNDS[state.round];
    const list = state.questions[r.key];
    if (state.q >= list.length) {
      state.round++;
      if (state.round >= ROUNDS.length) return finish();
      return showIntro();
    }
    const item = list[state.q];
    state.current = { item, firstTry: true, done: false };
    $("q-progress").textContent = "Vraag " + (state.q + 1) + " / " + list.length;
    $("q-topic").textContent = state.topicId === ALL_ID ? item.topicTitle : "";
    $("q-text").textContent = TYPE_QUESTION[item.type] || "Wat is dit?";
    $("feedback").className = "feedback hidden";
    $("btn-next").classList.add("hidden");
    ["mc-box", "hang-box", "type-box"].forEach((id) => $(id).classList.add("hidden"));
    showOnMap(item);
    if (r.key === "mc") renderMC(item);
    else if (r.key === "hang") renderHang(item);
    else renderType(item);
  }

  function finishQuestion(correctFirst, message, kind) {
    const c = state.current;
    if (c.done) return;
    c.done = true;
    const roundKey = ROUNDS[state.round].key;
    if (correctFirst) {
      state.score[roundKey]++;
      $("tb-score").textContent = String(state.score.mc + state.score.hang + state.score.type);
    }
    state.log.push({ round: roundKey, label: c.item.label, type: c.item.type, ok: correctFirst });
    feedback(message, kind);
    revealOnMap(c.item);
    state.q++;
    const isLast = state.q >= state.questions[roundKey].length;
    $("btn-next").textContent = isLast ? (state.round === ROUNDS.length - 1 ? "Naar de uitslag 🏁" : "Volgende ronde ▶") : "Volgende ▶";
    $("btn-next").classList.remove("hidden");
    setTimeout(() => $("btn-next").focus(), 30);
  }

  function feedback(html, kind) {
    const fb = $("feedback");
    fb.innerHTML = html;
    fb.className = "feedback " + kind;
  }

  // ---------- Round 1: multiple choice ----------
  function distractors(item, count) {
    const same = (i) => norm(i.name) !== norm(item.name);
    const uniq = (arr) => {
      const seen = new Set([norm(item.name)]);
      return arr.filter((i) => {
        const k = norm(i.name);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    };
    const topicItems = TOPIC_BY_ID[item.topicId].items;
    const tiers = [
      shuffle(topicItems.filter((i) => i.type === item.type && same(i))),
      shuffle(state.pool.filter((i) => i.type === item.type && same(i))),
      shuffle(ALL_ITEMS.filter((i) => i.type === item.type && same(i))),
      shuffle(topicItems.filter(same)),
    ];
    return uniq(tiers.flat()).slice(0, count);
  }

  function renderMC(item) {
    const box = $("mc-box");
    const options = shuffle([item, ...distractors(item, 3)]);
    box.innerHTML = "";
    options.forEach((opt, idx) => {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = '<span class="key">' + "ABCD"[idx] + "</span><span>" + esc(opt.label) + "</span>";
      b.dataset.correct = opt === item ? "1" : "0";
      b.addEventListener("click", () => onMCClick(b));
      box.appendChild(b);
    });
    box.classList.remove("hidden");
  }

  function onMCClick(btn) {
    const c = state.current;
    if (c.done || btn.disabled) return;
    if (btn.dataset.correct === "1") {
      btn.classList.add("right");
      $("mc-box").querySelectorAll("button").forEach((b) => (b.disabled = true));
      finishQuestion(
        c.firstTry,
        c.firstTry ? "✅ Goed! In 1x goed, +1 punt." : "👍 Nu wel goed, maar niet in 1x. Geen punt.",
        c.firstTry ? "good" : "warn"
      );
    } else {
      btn.classList.add("wrong");
      btn.disabled = true;
      c.firstTry = false;
      feedback("❌ Helaas, dat is het niet. Probeer het nog eens!", "bad");
    }
  }

  // ---------- Round 2: hangman ----------
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const baseLetter = (ch) => stripAccents(ch).toUpperCase();

  function renderHang(item) {
    const c = state.current;
    c.word = item.name;
    c.guessed = new Set();
    c.wrong = 0;
    c.needed = new Set(
      c.word
        .split("")
        .map(baseLetter)
        .filter((ch) => /[A-Z]/.test(ch))
    );
    const keys = $("hang-keys");
    keys.innerHTML = "";
    LETTERS.forEach((L_) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = L_;
      b.dataset.letter = L_;
      b.addEventListener("click", () => guessLetter(L_));
      keys.appendChild(b);
    });
    $("gallows").classList.remove("dead");
    drawHang();
    $("hang-box").classList.remove("hidden");
  }

  function drawHang(reveal) {
    const c = state.current;
    const words = c.word.split(" ");
    $("hang-word").innerHTML = words
      .map(
        (w) =>
          '<span class="w">' +
          w
            .split("")
            .map((ch) => {
              const base = baseLetter(ch);
              if (!/[A-Z]/.test(base)) return '<span class="ch sym">' + esc(ch) + "</span>";
              const known = c.guessed.has(base);
              if (known) return '<span class="ch got">' + esc(ch.toUpperCase()) + "</span>";
              if (reveal) return '<span class="ch miss">' + esc(ch.toUpperCase()) + "</span>";
              return '<span class="ch"></span>';
            })
            .join("") +
          "</span>"
      )
      .join("");
    $("hang-lives").textContent = String(MAX_WRONG - c.wrong);
    document.querySelectorAll("#gallows .g-part").forEach((g) => g.classList.toggle("on", Number(g.dataset.step) <= c.wrong));
  }

  function guessLetter(letter) {
    const c = state.current;
    if (!c || c.done || ROUNDS[state.round].key !== "hang" || c.guessed.has(letter)) return;
    c.guessed.add(letter);
    const btn = $("hang-keys").querySelector('[data-letter="' + letter + '"]');
    const hit = c.needed.has(letter);
    if (btn) {
      btn.disabled = true;
      btn.classList.add(hit ? "hit" : "miss");
    }
    if (!hit) c.wrong++;
    drawHang();
    const solved = [...c.needed].every((l) => c.guessed.has(l));
    if (solved) {
      disableKeys();
      const extra = c.wrong === 0 ? " Zonder één foute letter! 🌟" : "";
      finishQuestion(true, "✅ Geraden: <b>" + esc(c.item.label) + "</b>. +1 punt." + extra, "good");
    } else if (c.wrong >= MAX_WRONG) {
      disableKeys();
      $("gallows").classList.add("dead");
      drawHang(true);
      finishQuestion(false, "💀 Opgehangen! Het juiste antwoord was <b>" + esc(c.item.label) + "</b>.", "bad");
    }
  }

  function disableKeys() {
    $("hang-keys").querySelectorAll("button").forEach((b) => (b.disabled = true));
  }

  // ---------- Round 3: typing ----------
  function renderType() {
    const c = state.current;
    c.attempts = 0;
    const inp = $("type-input");
    inp.value = "";
    inp.disabled = false;
    $("type-box").querySelectorAll("button").forEach((b) => (b.disabled = false));
    $("type-box").classList.remove("hidden");
    setTimeout(() => inp.focus(), 50);
  }

  function checkTyped(e) {
    e.preventDefault();
    const c = state.current;
    if (!c || c.done) return;
    const raw = $("type-input").value.trim();
    if (!raw) return;
    const guess = norm(raw);
    const ok = accepted(c.item);
    if (ok.includes(guess)) {
      lockType();
      finishQuestion(
        c.attempts === 0,
        c.attempts === 0
          ? "✅ Helemaal goed: <b>" + esc(c.item.label) + "</b>. +1 punt."
          : "👍 Nu goed: <b>" + esc(c.item.label) + "</b>. Niet in 1x, dus geen punt.",
        c.attempts === 0 ? "good" : "warn"
      );
      return;
    }
    c.attempts++;
    const dist = Math.min(...ok.map((a) => levenshtein(guess, a)));
    const close = dist <= (guess.length >= 8 ? 2 : 1);
    if (c.attempts >= 2) {
      lockType();
      finishQuestion(false, "❌ Helaas. Het juiste antwoord is <b>" + esc(c.item.label) + "</b>.", "bad");
    } else if (close) {
      feedback("✏️ Bijna! Let goed op de spelling en probeer het nog één keer.", "warn");
      $("type-input").select();
    } else {
      feedback("❌ Dat is het niet. Je mag het nog één keer proberen.", "bad");
      $("type-input").select();
    }
  }

  function giveUp() {
    const c = state.current;
    if (!c || c.done) return;
    lockType();
    finishQuestion(false, "Het juiste antwoord is <b>" + esc(c.item.label) + "</b>.", "bad");
  }

  function lockType() {
    $("type-input").disabled = true;
    $("type-box").querySelectorAll("button").forEach((b) => (b.disabled = true));
  }

  // ---------- Finish & scoreboard ----------
  function finish() {
    timer.pause();
    const time = Math.round(timer.elapsed());
    clearInterval(timer.handle);
    timer.handle = null;
    const total = state.n * 3;
    const correct = state.score.mc + state.score.hang + state.score.type;
    const entry = {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      name: state.name,
      topicId: state.topicId,
      topicTitle: state.topicTitle,
      n: state.n,
      correct,
      total,
      mc: state.score.mc,
      hang: state.score.hang,
      type: state.score.type,
      time,
      date: new Date().toISOString(),
    };
    const scores = storage.get(STORAGE_KEY, []);
    scores.push(entry);
    storage.set(STORAGE_KEY, scores.slice(-300));

    const pct = correct / total;
    $("end-title").textContent =
      pct === 1 ? "Perfect! Jij bent een topokampioen! 🏆" : pct >= 0.8 ? "Super gedaan! 🌟" : pct >= 0.6 ? "Goed bezig! 👍" : "Blijven oefenen! 💪";
    $("end-score").textContent = String(correct);
    $("end-total").textContent = String(total);
    $("end-time").textContent = fmtTime(time);
    $("end-r1").textContent = state.score.mc + "/" + state.n;
    $("end-r2").textContent = state.score.hang + "/" + state.n;
    $("end-r3").textContent = state.score.type + "/" + state.n;
    const roundName = { mc: "Meerkeuze", hang: "Galgje", type: "Typen" };
    $("end-review").innerHTML = state.log
      .map(
        (l) =>
          '<li><span><span class="muted">' + roundName[l.round] + " · </span>" + esc(l.label) + "</span>" +
          (l.ok ? '<span class="ok">✔ in 1x</span>' : '<span class="ko">✘</span>') + "</li>"
      )
      .join("");
    $("sb-end-topic").textContent = state.topicTitle;
    $("sb-end").innerHTML = scoreTable(state.topicId, entry.id);
    show("end");
    if (pct >= 0.8) confetti();
  }

  function sortedScores(topicId) {
    return storage
      .get(STORAGE_KEY, [])
      .filter((s) => topicId === "" || s.topicId === topicId)
      .sort((a, b) => b.correct / b.total - a.correct / a.total || b.correct - a.correct || a.time - b.time);
  }

  function scoreTable(topicId, highlightId) {
    const list = sortedScores(topicId);
    if (!list.length) return '<p class="sb-empty">Nog geen scores. Wees de eerste! 🚀</p>';
    let rows = list.slice(0, 10);
    const myIdx = list.findIndex((s) => s.id === highlightId);
    if (myIdx >= 10) rows = rows.concat([list[myIdx]]);
    const medal = ["🥇", "🥈", "🥉"];
    return (
      '<table class="sb"><thead><tr><th>#</th><th>Naam</th><th class="num">In 1x goed</th><th class="num">Tijd</th></tr></thead><tbody>' +
      rows
        .map((s) => {
          const rank = list.indexOf(s);
          const d = new Date(s.date);
          const sub = (topicId === "" ? s.topicTitle + " · " : "") + d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
          return (
            '<tr class="' + (s.id === highlightId ? "me" : "") + '">' +
            '<td class="rank">' + (medal[rank] || rank + 1) + "</td>" +
            '<td class="name">' + esc(s.name) + '<span class="sub">' + esc(sub) + "</span></td>" +
            '<td class="num"><b>' + s.correct + "</b>/" + s.total + "</td>" +
            '<td class="num">' + fmtTime(s.time) + "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table>"
    );
  }

  function renderStartScoreboard() {
    $("sb-start").innerHTML = scoreTable($("sb-filter").value, null);
  }

  function confetti() {
    const colors = ["#ffc53d", "#2fd08a", "#5aa9ff", "#ff5d6c", "#c084fc"];
    for (let i = 0; i < 90; i++) {
      const el = document.createElement("div");
      el.className = "confetti";
      el.style.left = Math.random() * 100 + "vw";
      el.style.background = colors[i % colors.length];
      el.style.animationDuration = 2 + Math.random() * 2.5 + "s";
      el.style.animationDelay = Math.random() * 0.6 + "s";
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 5500);
    }
  }

  // ---------- Start screen setup ----------
  function setupStart() {
    const sel = $("sel-topic");
    const filter = $("sb-filter");
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = TOPICS.find((t) => t.date && t.date >= today);
    TOPICS.forEach((t) => {
      const o = document.createElement("option");
      o.value = t.id;
      o.textContent = (t.date ? fmtDate(t.date) + " — " : "Extra — ") + t.title + (upcoming && t.id === upcoming.id ? "  (volgende toets)" : "");
      sel.appendChild(o);
      const f = document.createElement("option");
      f.value = t.id;
      f.textContent = t.title;
      filter.appendChild(f);
    });
    const all = document.createElement("option");
    all.value = ALL_ID;
    all.textContent = "🌍 Alles door elkaar";
    sel.appendChild(all);
    const fAll = document.createElement("option");
    fAll.value = ALL_ID;
    fAll.textContent = "Alles door elkaar";
    filter.appendChild(fAll);
    const fAny = document.createElement("option");
    fAny.value = "";
    fAny.textContent = "Alle scores";
    filter.insertBefore(fAny, filter.firstChild);

    sel.value = upcoming ? upcoming.id : TOPICS[0].id;
    filter.value = sel.value;
    sel.addEventListener("change", () => {
      filter.value = sel.value;
      renderStartScoreboard();
    });
    filter.addEventListener("change", renderStartScoreboard);

    $("inp-name").value = storage.get(NAME_KEY, "");
    document.querySelectorAll("#seg-count button").forEach((b) =>
      b.addEventListener("click", () => {
        document.querySelectorAll("#seg-count button").forEach((x) => x.classList.toggle("on", x === b));
      })
    );
    renderStartScoreboard();
  }

  function goHome() {
    timer.reset();
    state = null;
    $("sb-filter").value = $("sel-topic").value;
    renderStartScoreboard();
    show("start");
  }

  // ---------- Events ----------
  $("start-form").addEventListener("submit", (e) => {
    e.preventDefault();
    startQuiz();
  });
  $("btn-intro-go").addEventListener("click", beginRound);
  $("btn-next").addEventListener("click", nextQuestion);
  $("type-box").addEventListener("submit", checkTyped);
  $("btn-giveup").addEventListener("click", giveUp);
  $("btn-recenter").addEventListener("click", () => currentBounds && map.fitBounds(currentBounds));
  $("btn-quit").addEventListener("click", () => {
    if (confirm("Weet je zeker dat je wilt stoppen? Je score wordt dan niet bewaard.")) goHome();
  });
  $("btn-again").addEventListener("click", startQuiz);
  $("btn-home").addEventListener("click", goHome);
  $("btn-clear").addEventListener("click", () => {
    if (confirm("Alle scores op dit apparaat wissen?")) {
      storage.set(STORAGE_KEY, []);
      renderStartScoreboard();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (!state || e.ctrlKey || e.metaKey || e.altKey) return;
    const onQuiz = !$("screen-quiz").classList.contains("hidden");
    if (!onQuiz) return;
    const c = state.current;
    if (c && c.done && e.key === "Enter" && document.activeElement !== $("btn-next")) {
      e.preventDefault();
      nextQuestion();
      return;
    }
    const key = ROUNDS[state.round] && ROUNDS[state.round].key;
    if (key === "hang" && /^[a-zA-Z]$/.test(e.key)) {
      guessLetter(e.key.toUpperCase());
    } else if (key === "mc" && /^[1-4a-dA-D]$/.test(e.key) && c && !c.done) {
      const idx = /\d/.test(e.key) ? Number(e.key) - 1 : "abcd".indexOf(e.key.toLowerCase());
      const btn = $("mc-box").querySelectorAll("button")[idx];
      if (btn) onMCClick(btn);
    }
  });

  setupStart();
})();
