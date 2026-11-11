'use strict';

(function () {
  const WORDS = window.WORDS || [];
  const TOPICS = window.TOPICS || [];
  const WORD_MAP = new Map(WORDS.map((w) => [w.w, w]));
  const TOPIC_MAP = new Map(TOPICS.map((t) => [t.id, t]));
  const KEY = 'ielts.vocab.v1';
  const INTERVALS = [1, 2, 4, 8, 16, 32];
  const MASTER_BOX = 4;
  const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const KINDS = ['zh', 'en', 'spell', 'listen'];
  // 艾宾浩斯复习间隔（天）：错词按这个节奏往后推
  const EBB = [1, 2, 4, 7, 15, 30, 60];
  const WRONG_BATCH = 20;
  const REPO = 'sutranixm-svg/ielts-words';
  const RELEASES_API = 'https://api.github.com/repos/' + REPO + '/releases/latest';
  const APP_VERSION = (window.App && window.App.version && window.App.version()) || '0';
  const NEWS_URL = 'https://raw.githubusercontent.com/' + REPO + '/main/data/articles.json';
  const NEWS_TTL = 6 * 3600 * 1000;
  const CAT_LABEL = { tech: '科技', business: '财经', life: '生活', culture: '文娱' };

  /* ---------- 基础工具 ---------- */

  const pad = (n) => String(n).padStart(2, '0');
  const dayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function parseDay(s) {
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }
  function addDays(s, n) {
    const d = parseDay(s);
    d.setDate(d.getDate() + n);
    return dayStr(d);
  }
  const shortDay = (s) => {
    const [, m, d] = String(s).split('-');
    return `${Number(m)}/${Number(d)}`;
  };
  const dateLabel = (d = new Date()) => `${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${WEEKDAYS[d.getDay()]}`;

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a += 0x6d2b79f5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(list, rnd = Math.random) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const sample = (list, n) => shuffle(list).slice(0, n);
  const dayNum = (s) => Math.floor(parseDay(s).getTime() / 86400000);

  /* ---------- 状态 ---------- */

  function fresh() {
    return {
      v: 1,
      words: {},
      days: {},
      settings: { dailyNew: 15, dailyGoal: 20, examDate: '', decks: TOPICS.map((t) => t.id) },
      session: null,
      quiz: null,
      lastSession: null,
      update: null,
      seenUpdate: '',
      news: { fetched: '', items: [] },
      writing: {},
      ui: { tab: 'today', screen: null, confirm: null },
    };
  }

  function normalize(raw) {
    const base = fresh();
    const o = raw && typeof raw === 'object' ? raw : {};
    return {
      ...base,
      ...o,
      v: 1,
      words: o.words && typeof o.words === 'object' ? o.words : {},
      days: o.days && typeof o.days === 'object' ? o.days : {},
      settings: { ...base.settings, ...(o.settings || {}) },
      news: o.news && Array.isArray(o.news.items) ? o.news : base.news,
      ui: { ...base.ui, ...(o.ui || {}) },
    };
  }

  let S = (function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) {}
    return fresh();
  })();

  // 跨天时丢弃旧的学习队列，避免第二天接着昨天的卡
  if (S.session && S.session.day && S.session.day !== dayStr()) S.session = null;

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(S));
    } catch (e) {}
  }

  function today() {
    return dayStr();
  }
  function dayRec(day = today()) {
    if (!S.days[day]) S.days[day] = { new: 0, review: 0, right: 0, wrong: 0 };
    return S.days[day];
  }
  function ensureRec(w) {
    if (!S.words[w]) {
      S.words[w] = { box: 0, due: today(), seen: 0, right: 0, wrong: 0, first: today(), last: null,
                     wstep: 0, wdue: today(), wlast: null };
    }
    return S.words[w];
  }
  function applyGrade(rec, grade, day = today()) {
    const first = rec.seen === 0;
    rec.seen += 1;
    rec.last = day;
    if (grade === 'good') {
      rec.right += 1;
      rec.box = Math.min(5, (rec.box || 0) + 1);
      rec.due = addDays(day, INTERVALS[rec.box]);
    } else if (grade === 'hard') {
      rec.box = Math.max(1, rec.box || 0);
      rec.due = addDays(day, 1);
    } else {
      rec.wrong += 1;
      rec.box = 0;
      rec.due = addDays(day, 1);
      markWrong(rec, day);
    }
    if (first) rec.first = day;
    return rec;
  }

  /* ---------- 词库选择 ---------- */

  function activeDecks() {
    const picked = S.settings.decks;
    if (!Array.isArray(picked)) return TOPICS.map((t) => t.id);
    return picked.filter((id) => TOPIC_MAP.has(id));
  }

  function deckWords() {
    const set = new Set(activeDecks());
    return WORDS.filter((w) => set.has(w.t));
  }

  /* ---------- 错词复习（艾宾浩斯曲线） ---------- */

  function wrongRec(w) {
    const r = S.words[w];
    if (!r) return null;
    if (typeof r.wstep !== 'number') r.wstep = 0;
    if (!r.wdue) r.wdue = r.last || today();
    return r;
  }

  function markWrong(rec, day) {
    rec.wstep = 0;
    rec.wdue = addDays(day, EBB[0]);
    rec.wlast = day;
  }

  function markWrongPassed(rec, day) {
    rec.wstep = Math.min(EBB.length - 1, (rec.wstep || 0) + 1);
    rec.wdue = addDays(day, EBB[rec.wstep]);
    rec.wlast = day;
  }

  function wrongPool() {
    return deckWords().filter((w) => {
      const r = S.words[w.w];
      return r && r.seen && r.wrong > 0 && r.box < MASTER_BOX;
    });
  }

  function wrongDueOn(day) {
    return wrongPool().filter((w) => {
      const r = wrongRec(w.w);
      return r && (r.wdue || day) <= day;
    });
  }

  /* ---------- 统计 ---------- */

  function stats() {
    const day = today();
    const rows = TOPICS.map((t) => ({ ...t, total: 0, seen: 0, mastered: 0 }));
    const byTopic = new Map(rows.map((t) => [t.id, t]));
    let seen = 0;
    let mastered = 0;
    let due = 0;
    for (const w of WORDS) {
      const row = byTopic.get(w.t);
      if (row) row.total += 1;
      const r = S.words[w.w];
      if (!r || !r.seen) continue;
      seen += 1;
      if (row) row.seen += 1;
      if (r.box >= MASTER_BOX) {
        mastered += 1;
        if (row) row.mastered += 1;
      }
      if (r.due <= day) due += 1;
    }
    const d = S.days[day] || { new: 0, review: 0, right: 0, wrong: 0 };
    const week = [];
    for (let i = 6; i >= 0; i -= 1) {
      const dd = addDays(day, -i);
      const r = S.days[dd];
      week.push({ day: dd, label: shortDay(dd), value: r ? (r.new || 0) + (r.review || 0) : 0 });
    }
    const wrong = [];
    for (const w of WORDS) {
      const r = S.words[w.w];
      if (r && r.seen && r.wrong > 0 && r.box < MASTER_BOX) {
        wrong.push({ w: w.w, zh: w.zh, pos: w.pos, count: r.wrong });
      }
    }
    wrong.sort((a, b) => b.count - a.count || a.w.localeCompare(b.w));
    let right = 0;
    let wrongN = 0;
    for (const r of Object.values(S.days)) {
      right += r.right || 0;
      wrongN += r.wrong || 0;
    }
    let d0 = studiedOn(day) ? day : addDays(day, -1);
    let streak = 0;
    while (studiedOn(d0)) {
      streak += 1;
      d0 = addDays(d0, -1);
    }
    const total = deckWords().length;
    return {
      today: { new: d.new || 0, review: d.review || 0, total: (d.new || 0) + (d.review || 0) },
      newLeft: Math.max(0, S.settings.dailyNew - (d.new || 0)),
      due,
      seen,
      mastered,
      total,
      streak,
      week,
      wrong,
      wrongDue: wrongDueOn(day).length,
      topics: rows,
      accuracy: right + wrongN ? Math.round((right / (right + wrongN)) * 100) : 0,
    };
  }

  function studiedOn(day) {
    const r = S.days[day];
    return Boolean(r && (r.new || 0) + (r.review || 0) > 0);
  }

  /* ---------- 学习队列 ---------- */

  function buildQueue(mode = 'daily') {
    const day = today();
    const rnd = mulberry32(dayNum(day) + 17);
    const pool = deckWords();
    const due = pool.filter((w) => {
      const r = S.words[w.w];
      return r && r.seen && r.due <= day;
    })
      .sort((a, b) => {
        const ra = S.words[a.w];
        const rb = S.words[b.w];
        return ra.due.localeCompare(rb.due) || (ra.box || 0) - (rb.box || 0);
      })
      .slice(0, 40);
    const todayNew = (S.days[day] && S.days[day].new) || 0;
    const cap = Math.max(0, S.settings.dailyNew - todayNew);
    const unseen = pool.filter((w) => !S.words[w.w] || !S.words[w.w].seen);
    const extraSize = Math.max(10, S.settings.dailyNew || 15);
    const newPicked = shuffle(unseen, rnd).slice(0, mode === 'extra' ? extraSize : cap);

    if (mode === 'review') return { queue: due.map((w) => ({ w: w.w, kind: 'review' })), newCount: 0, reviewCount: due.length };
    if (mode === 'new' || mode === 'extra') return { queue: newPicked.map((w) => ({ w: w.w, kind: 'new' })), newCount: newPicked.length, reviewCount: 0 };
    if (mode === 'drill') {
      const seen = pool.filter((w) => S.words[w.w] && S.words[w.w].seen);
      const picked = shuffle(seen, rnd).slice(0, 10);
      return { queue: picked.map((w) => ({ w: w.w, kind: 'review' })), newCount: 0, reviewCount: picked.length };
    }
    return {
      queue: [...due.map((w) => ({ w: w.w, kind: 'review' })), ...newPicked.map((w) => ({ w: w.w, kind: 'new' }))],
      newCount: newPicked.length,
      reviewCount: due.length,
    };
  }

  function beginStudy(mode = 'daily') {
    if (S.session && !S.session.done) {
      S.ui.tab = 'study';
      S.ui.screen = null;
      save();
      render();
      return;
    }
    let built = buildQueue(mode);
    if (!built.queue.length && mode === 'daily') built = buildQueue('drill');
    if (!built.queue.length) {
      toast(mode === 'extra'
        ? '新词已经全学完了，去测验巩固一下吧'
        : mode === 'review' ? '还没有到期的复习词' : '今天没有要学的词了，先测验一下吧');
      return;
    }
    S.session = {
      day: today(),
      queue: built.queue,
      pos: 0,
      revealed: false,
      done: false,
      results: { good: 0, hard: 0, again: 0 },
      newCount: built.newCount,
      reviewCount: built.reviewCount,
      requeued: {},
    };
    S.ui.tab = 'study';
    S.ui.screen = null;
    save();
    render();
  }

  function grade(g) {
    const s = S.session;
    if (!s || s.done) return;
    const item = s.queue[s.pos];
    if (!item) return;
    const rec = ensureRec(item.w);
    const first = rec.seen === 0;
    applyGrade(rec, g);
    const d = dayRec();
    if (first) d.new += 1;
    else d.review += 1;
    if (g === 'good') d.right += 1;
    if (g === 'again') d.wrong += 1;
    s.results[g] += 1;
    if (g === 'again') {
      const n = s.requeued[item.w] || 0;
      if (n < 2) {
        s.requeued[item.w] = n + 1;
        s.queue.push({ w: item.w, kind: 'review' });
      }
    }
    s.pos += 1;
    s.revealed = false;
    if (s.pos >= s.queue.length) {
      s.done = true;
      S.lastSession = {
        total: s.queue.length,
        good: s.results.good,
        hard: s.results.hard,
        again: s.results.again,
        newCount: s.newCount,
        reviewCount: s.reviewCount,
      };
    }
    save();
    render();
  }

  /* ---------- 测验 ---------- */

  function spellDistractors(word, pool) {
    const out = new Set();
    const push = (s) => {
      if (out.size >= 3 || typeof s !== 'string' || s === word || !/^[a-z]{3,20}$/.test(s) || Math.abs(s.length - word.length) > 3) return;
      out.add(s);
    };
    const rules = [
      (s) => s.replace(/ie/g, 'ei'),
      (s) => s.replace(/ei/g, 'ie'),
      (s) => s.replace(/([bcdfgklmnprstvz])\1/g, '$1'),
      (s) => s.replace(/([aeiou])([bcdfgklmnprstvz])([aeiou])/g, '$1$2$2$3'),
      (s) => s.replace(/ise$/, 'ize'),
      (s) => s.replace(/isation$/, 'ization'),
      (s) => s.replace(/our/g, 'or'),
      (s) => s.replace(/y$/, 'ey'),
    ];
    for (const rule of rules) push(rule(word));
    const vowels = 'aeiou';
    for (let i = 1; i < word.length && out.size < 3; i += 1) {
      if (vowels.includes(word[i])) push(word.slice(0, i) + word.slice(i + 1));
    }
    for (let i = 1; i < word.length && out.size < 3; i += 1) {
      if (!vowels.includes(word[i]) && word[i] !== word[i - 1]) push(word.slice(0, i) + word[i] + word.slice(i));
    }
    for (const other of shuffle(pool)) {
      if (out.size >= 3) break;
      if (other.w !== word && Math.abs(other.w.length - word.length) <= 2) push(other.w);
    }
    return [...out].slice(0, 3);
  }

  function makeItem(word, kind, pool) {
    const safePool = pool.length >= 4 ? pool : deckWords();
    if (kind === 'zh') {
      const others = sample(safePool.filter((w) => w.w !== word.w && w.zh !== word.zh), 3);
      const opts = shuffle([word.zh, ...others.map((w) => w.zh)]);
      return { w: word.w, kind, prompt: word.w, hint: '', options: opts, answer: opts.indexOf(word.zh), chosen: null, correct: null };
    }
    if (kind === 'listen') {
      const others = sample(safePool.filter((w) => w.w !== word.w && Math.abs(w.w.length - word.w.length) <= 3), 3);
      const opts = shuffle([word.w, ...others.map((w) => w.w)]);
      return { w: word.w, kind, prompt: '', hint: '听发音，选出正确的拼写', options: opts, answer: opts.indexOf(word.w), chosen: null, correct: null };
    }
    if (kind === 'en') {
      const others = sample(safePool.filter((w) => w.w !== word.w), 3);
      const opts = shuffle([word.w, ...others.map((w) => w.w)]);
      return { w: word.w, kind, prompt: `${word.pos} ${word.zh}`, hint: '选出对应的英文单词', options: opts, answer: opts.indexOf(word.w), chosen: null, correct: null };
    }
    const spell = spellDistractors(word.w, safePool);
    const opts = shuffle([word.w, ...spell]);
    return {
      w: word.w,
      kind: 'spell',
      prompt: word.zh,
      hint: `首字母 ${word.w[0]} · 共 ${word.w.length} 个字母`,
      options: opts,
      answer: opts.indexOf(word.w),
      chosen: null,
      correct: null,
    };
  }

  function startQuiz(kind) {
    const all = deckWords();
    const seen = all.filter((w) => S.words[w.w] && S.words[w.w].seen);
    let pool;
    let picked;
    if (kind === 'wrong' || kind === 'wrong-all') {
      const day = today();
      const dueList = wrongDueOn(day);
      const full = wrongPool();
      let source;
      if (kind === 'wrong-all') {
        // 全部过一遍：最久没复习的排前面，保证能轮到每一个
        source = full.slice().sort((a, b) => {
          const ra = wrongRec(a.w) || {};
          const rb = wrongRec(b.w) || {};
          return String(ra.wlast || '').localeCompare(String(rb.wlast || '')) || a.w.localeCompare(b.w);
        });
      } else if (dueList.length >= 4) {
        // 到期优先；同批里最久没复习的在前，再用当天轮次打散，避免每轮都是同一批
        S.wrongRound = (S.wrongRound || 0) + 1;
        const rnd = mulberry32(dayNum(day) * 31 + S.wrongRound);
        source = shuffle(dueList.slice(), rnd).sort((a, b) => {
          const ra = wrongRec(a.w) || {};
          const rb = wrongRec(b.w) || {};
          return String(ra.wlast || '').localeCompare(String(rb.wlast || ''));
        });
      } else {
        source = full.slice().sort((a, b) => {
          const ra = wrongRec(a.w) || {};
          const rb = wrongRec(b.w) || {};
          return String(ra.wdue || '').localeCompare(String(rb.wdue || ''));
        });
      }
      pool = source;
      picked = source.slice(0, Math.min(WRONG_BATCH, source.length));
      if (picked.length < 4) {
        toast('错词不足 4 个，先做普通测验吧');
        return;
      }
    } else {
      pool = seen.length >= 10 ? seen : all;
      picked = sample(pool, Math.min(10, pool.length));
      if (picked.length < 4) {
        toast('词库太小，先学几个词吧');
        return;
      }
    }
    const items = picked.map((w, i) => {
      let k = kind;
      if (kind === 'mix') k = KINDS[Math.floor(Math.random() * KINDS.length)];
      if (kind === 'wrong' || kind === 'wrong-all') k = i % 3 === 2 ? 'spell' : (i % 2 === 0 ? 'zh' : 'en');
      if (!KINDS.includes(k)) k = 'zh';
      return makeItem(w, k, pool);
    });
    S.quiz = { kind, items, pos: 0, answered: false, score: 0, done: false };
    S.ui.tab = 'quiz';
    S.ui.screen = null;
    save();
    render();
  }

  function answerQuiz(i) {
    const q = S.quiz;
    if (!q || q.done || q.answered) return;
    const item = q.items[q.pos];
    item.chosen = i;
    item.correct = i === item.answer;
    q.answered = true;
    if (item.correct) q.score += 1;
    const rec = S.words[item.w];
    if (q.kind === 'syn') {
      save();
      render();
      return;
    }
    if (rec && rec.seen) {
      if (q.kind === 'wrong' || q.kind === 'wrong-all') {
        const day = today();
        if (item.correct) {
          rec.right = (rec.right || 0) + 1;
          rec.box = Math.min(5, (rec.box || 0) + 1);
          rec.due = addDays(day, INTERVALS[rec.box]);
          markWrongPassed(rec, day);
        } else {
          rec.wrong = (rec.wrong || 0) + 1;
          rec.box = 0;
          rec.due = addDays(day, 1);
          markWrong(rec, day);
        }
        rec.last = day;
      } else {
        applyGrade(rec, item.correct ? 'good' : 'again');
      }
    }
    save();
    render();
  }

  function nextQuestion() {
    const q = S.quiz;
    if (!q || q.done || !q.answered) return;
    q.pos += 1;
    q.answered = false;
    if (q.pos >= q.items.length) q.done = true;
    save();
    render();
  }

  /* ---------- 渲染：通用 ---------- */

  const ICONS = {
    today: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1z"/>',
    study: '<rect x="3.5" y="6" width="12" height="15" rx="2.5"/><path d="M8 3.5h9A2.5 2.5 0 0 1 19.5 6v12"/>',
    quiz: '<circle cx="12" cy="12" r="8.5"/><path d="m8.4 12 2.3 2.3 5-5.4"/>',
    library: '<path d="M5 4.5h8A3.5 3.5 0 0 1 16.5 8v12H8.5A3.5 3.5 0 0 1 5 16.5z"/><path d="M5 16.5A3.5 3.5 0 0 1 8.5 13h8"/>',
    play: '<path d="M8 5.5 18 12 8 18.5z"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
    news: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H18a2 2 0 0 1 2 2v11a3 3 0 0 0-3 3H6.5A2.5 2.5 0 0 1 4 17.5z"/><path d="M8 8.5h8M8 12h8M8 15.5h4"/>',
  };
  const svg = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function ringSVG(pct, id = '') {
    const c = 2 * Math.PI * 52;
    const off = c * (1 - Math.max(0, Math.min(1, pct)));
    const gid = 'rg' + (id || Math.random().toString(36).slice(2, 6));
    return `<svg viewBox="0 0 120 120">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent2)"/>
      </linearGradient></defs>
      <circle cx="60" cy="60" r="52" fill="none" stroke="var(--track)" stroke-width="9"/>
      <circle cx="60" cy="60" r="52" fill="none" stroke="url(#${gid})" stroke-width="9" stroke-linecap="round"
        stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 60 60)"
        style="animation:ring .9s ease both"/>
    </svg>`;
  }

  function topbarHTML() {
    if (S.ui.screen === 'settings') {
      return `<div class="back"><button class="icon-btn" data-act="back" aria-label="返回">←</button><div><div class="top-title">设置</div><div class="top-sub">学习节奏与数据</div></div></div>`;
    }
    const TRAIN_TITLE = { speaking: ['口语 Part 2', '1 分钟准备 · 2 分钟作答'], writing: ['写作 Task 2', '40 分钟 · 250 词'], reading: ['阅读技巧', '题型与时间分配'], syn: ['同义替换', 'paraphrase 训练'] };
    if (TRAIN_TITLE[S.ui.screen]) {
      const tt = TRAIN_TITLE[S.ui.screen];
      return `<div class="back"><button class="icon-btn" data-act="back" aria-label="返回">←</button><div><div class="top-title">${tt[0]}</div><div class="top-sub">${tt[1]}</div></div></div>`;
    }
    if (typeof S.ui.screen === 'string' && (S.ui.screen.indexOf('cue:') === 0 || S.ui.screen.indexOf('wtop:') === 0)) {
      const isCue = S.ui.screen.indexOf('cue:') === 0;
      return `<div class="back"><button class="icon-btn" data-act="back" aria-label="返回">←</button><div><div class="top-title">${isCue ? '口语 Part 2' : '写作 Task 2'}</div><div class="top-sub">${isCue ? '计时练习' : '草稿只存本机'}</div></div></div>`;
    }
    if (S.ui.screen === 'decks') {
      return `<div class="back"><button class="icon-btn" data-act="back" aria-label="返回">←</button><div><div class="top-title">学习范围</div><div class="top-sub">${activeDecks().length} / ${TOPICS.length} 个词库</div></div></div>`;
    }
    if (typeof S.ui.screen === 'string' && S.ui.screen.indexOf('words:') === 0) {
      const tt = TOPIC_MAP.get(S.ui.screen.slice(6));
      return `<div class="back"><button class="icon-btn" data-act="back" aria-label="返回">←</button><div><div class="top-title">${esc(tt ? tt.zh : '词表')}</div><div class="top-sub">${topicList(S.ui.screen.slice(6)).length} 词</div></div></div>`;
    }
    if (typeof S.ui.screen === 'string' && S.ui.screen.indexOf('news:') === 0) {
      return `<div class="back"><button class="icon-btn" data-act="news-back" aria-label="返回">←</button><div><div class="top-title">外刊精读</div><div class="top-sub">中英对照</div></div></div>`;
    }
    if (S.ui.screen === 'wrong') {
      return `<div class="back"><button class="icon-btn" data-act="back" aria-label="返回">←</button><div><div class="top-title">错词本</div><div class="top-sub">${stats().wrong.length} 个待巩固</div></div></div>`;
    }
    if (S.ui.tab === 'study' && S.session && !S.session.done) {
      return `<div class="back"><button class="icon-btn" data-act="pause" aria-label="回到今天">←</button><div><div class="top-title">学习中</div><div class="top-sub">${S.session.pos + 1} / ${S.session.queue.length} 张卡片</div></div></div>`;
    }
    if (S.ui.tab === 'quiz' && S.quiz && !S.quiz.done) {
      return `<div class="back"><button class="icon-btn" data-act="pause" aria-label="回到今天">←</button><div><div class="top-title">测验中</div><div class="top-sub">第 ${S.quiz.pos + 1} / ${S.quiz.items.length} 题</div></div></div>`;
    }
    const st = stats();
    return `<div class="brand"><img class="logo-img" src="avatar.png" alt="鲸娘"><div><div><div class="brand-name">雅思单词</div><div class="brand-sub">IELTS VOCABULARY</div></div></div>
      <div class="streak"><span class="fire">🔥</span><b>${st.streak}</b><span>天</span></div>`;
  }

  function tabbarHTML() {
    let active = S.ui.tab;
    if (S.ui.screen === 'settings' || S.ui.screen === 'wrong') active = 'library';
    if (S.ui.screen === 'decks' || (typeof S.ui.screen === 'string' && S.ui.screen.indexOf('words:') === 0)) active = 'library';
    const tabs = [
      ['today', '今天'],
      ['study', '学习'],
      ['quiz', '测验'],
      ['news', '外刊'],
      ['library', '词库'],
    ];
    return `<div class="tabbar-inner">${tabs
      .map(
        ([id, label]) =>
          `<button class="tab ${active === id ? 'active' : ''}" data-act="tab:${id}">${svg(id)}<span>${label}</span></button>`
      )
      .join('')}</div>`;
  }

  /* ---------- 渲染：今天 ---------- */

  /* ---------- 更新检查 ---------- */

  let updateState = '';

  function cmpVersion(a, b) {
    const pa = String(a).replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
    const pb = String(b).replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  function checkUpdate(manual) {
    if (!window.fetch) return;
    fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((j) => {
        const tag = j && j.tag_name ? j.tag_name : '';
        const apk = ((j && j.assets) || []).find((a) => /\.apk$/i.test(a.name || ''));
        if (!tag || !apk) throw new Error('no apk');
        if (cmpVersion(tag, APP_VERSION) <= 0) {
          S.update = null;
          save();
          render();
          if (manual) toast('已是最新版本 v' + APP_VERSION);
          return;
        }
        const ver = String(tag).replace(/^v/i, '');
        S.update = { version: ver, url: apk.browser_download_url, size: apk.size };
        if (S.seenUpdate === ver) S.seenUpdate = '';
        save();
        render();
        if (manual) toast('发现新版本 v' + ver);
      })
      .catch(() => {
        if (manual) toast('检查更新失败，稍后再试');
      });
  }

  function updateBanner() {
    const u = S.update;
    if (!u || !u.version || u.version === S.seenUpdate) return '';
    let right;
    if (updateState === 'downloading') right = '<span class="ub-state">下载中…</span>';
    else if (updateState.indexOf('progress:') === 0) right = `<span class="ub-state">${updateState.slice(9)}%</span>`;
    else if (updateState === 'installing') right = '<span class="ub-state">安装中…</span>';
    else right = '<button class="btn primary xs" data-act="update">一键更新</button>';
    const sub = updateState.indexOf('error:') === 0
      ? '更新失败：' + esc(updateState.slice(6))
      : `新版本 v${esc(u.version)} · 约 ${Math.round((u.size || 0) / 1048576 * 10) / 10} MB`;
    return `<section class="update-bar">
        <div class="ub-body">
          <b>有新版本可更新</b>
          <span>${sub}</span>
        </div>
        ${right}
        <button class="icon-btn xs" data-act="update-later" aria-label="稍后再说">×</button>
      </section>`;
  }

  window.__updateStatus = function (status) {
    updateState = String(status || '');
    if (updateState === 'installing') toast('安装包就绪，按提示完成安装');
    if (updateState.indexOf('error:') === 0) toast('更新失败：' + updateState.slice(6));
    render();
  };

  /* ---------- 语音朗读 ---------- */

  let ttsReady = false;

  function speak(text, rate) {
    try {
      if (!window.speechSynthesis) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text || ''));
      u.lang = 'en-US';
      u.rate = rate || 0.92;
      const vs = (speechSynthesis.getVoices && speechSynthesis.getVoices()) || [];
      const v = vs.find((x) => /^en[-_]US/i.test(x.lang)) || vs.find((x) => /^en/i.test(x.lang));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
      ttsReady = true;
    } catch (e) {
      /* 没有语音引擎就静默失败，不影响其他功能 */
    }
  }

  if (window.speechSynthesis && speechSynthesis.addEventListener) {
    speechSynthesis.addEventListener('voiceschanged', function () { ttsReady = true; });
  }

  /* ---------- 备考计划 ---------- */

  function daysToExam() {
    const d = S.settings.examDate;
    if (!d) return null;
    const ms = parseDay(d) - parseDay(today());
    return Math.ceil(ms / 86400000);
  }

  function planInfo() {
    const days = daysToExam();
    if (days === null) return null;
    const pool = deckWords();
    const unseen = pool.filter((w) => !S.words[w.w] || !S.words[w.w].seen).length;
    const raw = days > 0 ? Math.ceil(unseen / days) : unseen;
    const perDay = Math.max(5, Math.min(60, raw));
    return { days, unseen, perDay, raw, feasible: raw <= 60, exam: S.settings.examDate };
  }

  /* ---------- 模考 ---------- */

  function bandOf(pct) {
    if (pct >= 93) return '8.0';
    if (pct >= 87) return '7.5';
    if (pct >= 80) return '7.0';
    if (pct >= 72) return '6.5';
    if (pct >= 63) return '6.0';
    if (pct >= 55) return '5.5';
    if (pct >= 47) return '5.0';
    if (pct >= 38) return '4.5';
    if (pct >= 30) return '4.0';
    return '3.5 或以下';
  }

  function startMock() {
    const all = deckWords();
    const seen = all.filter((w) => S.words[w.w] && S.words[w.w].seen);
    const pool = seen.length >= 20 ? seen : all;
    const picked = sample(pool, 20);
    if (picked.length < 20) {
      toast('词库太小，至少需要 20 个词');
      return;
    }
    const items = picked.map((w, i) => {
      const k = i % 3 === 2 ? 'listen' : (i % 2 === 0 ? 'zh' : 'en');
      return makeItem(w, k, pool);
    });
    S.quiz = {
      kind: 'mock',
      items,
      pos: 0,
      answered: false,
      score: 0,
      done: false,
      mock: true,
      ends: Date.now() + 15 * 60 * 1000,
    };
    S.ui.tab = 'quiz';
    S.ui.screen = null;
    save();
    render();
  }

  function todayScreen() {
    const st = stats();
    const done = st.today.total;
    const goal = S.settings.dailyGoal;
    const pct = goal ? done / goal : 0;
    const inProgress = Boolean(S.session && !S.session.done);
    let tip;
    if (inProgress) tip = '有一组学习还没做完，接着来吧。';
    else if (st.due > 0) tip = `有 ${st.due} 个词到复习时间了，先复习再学新词。`;
    else if (st.newLeft > 0) tip = `今天还可以学 ${st.newLeft} 个新词。`;
    else tip = '今天的新词学完了，做一组测验巩固一下。';
    const label = inProgress ? '继续学习' : st.due > 0 || st.newLeft > 0 ? '开始今日学习' : '加练 10 个词';
    const maxWeek = Math.max(1, ...st.week.map((d) => d.value));
    const week = st.week
      .map((d) => {
        const h = Math.max(4, Math.round((d.value / maxWeek) * 92));
        const isToday = d.day === today();
        return `<div class="col ${isToday ? 'today' : ''}"><div class="v">${d.value || ''}</div><div class="bar" style="height:${h}px"></div><div class="d">${d.label}</div></div>`;
      })
      .join('');
    const bubble = pct >= 1
      ? '今天达标啦，鲸娘陪你收工。'
      : inProgress
        ? '还差几张卡片，继续？'
        : st.due > 0
          ? `有 ${st.due} 个词到期了，先复习？`
          : st.newLeft > 0
            ? `今天还有 ${st.newLeft} 个新词，来一组？`
            : '今天的词学完了，做组测验？';
    const plan = planInfo();
    const planBar = plan
      ? `<section class="exam-bar">
          <div class="eb-main">
            <b>${plan.days > 0 ? plan.days + ' 天' : '已到考试日'}</b>
            <span>${plan.days > 0 ? '距离考试' : ''} · 还剩 ${plan.unseen} 个词${plan.feasible ? '' : ' · 按 60/天 背不完，建议先只学雅思词表'}</span>
          </div>
          <button class="btn primary xs" data-act="apply-plan">每天 ${plan.perDay} 个</button>
        </section>`
      : `<button class="exam-empty" data-act="open:settings">设置考试日期，自动算每天该背多少 ›</button>`;
    return `<div class="screen">
      ${updateBanner()}
      ${planBar}
      <section class="coach">
        <img class="coach-ava" src="avatar.png" alt="鲸娘">
        <div class="coach-body">
          <div class="coach-date">${dateLabel()}</div>
          <div class="coach-say">${bubble}</div>
        </div>
      </section>

      <section class="hero">
        <div class="ring">${ringSVG(pct, 'today')}<div class="center"><b>${pct >= 1 ? '✓' : done}</b><small>${pct >= 1 ? '达标' : '今日已学'}</small></div></div>
        <div class="hero-info">
          <div class="eyebrow">今日目标</div>
          <div class="hero-num">${done}<span> / ${goal} 张</span></div>
          <div class="hero-sub">${pct >= 1 ? '目标完成，状态不错' : tip}</div>
          <div class="pill">🔥 连续 ${st.streak} 天</div>
        </div>
      </section>

      <div class="chips">
        <div class="chip"><b>${st.due}</b><span>待复习</span></div>
        <div class="chip"><b>${done}</b><span>今日已学</span></div>
        <div class="chip"><b>${st.mastered}</b><span>已掌握</span></div>
      </div>

      <button class="btn primary" data-act="start"><span class="ico">${svg('play')}</span>${label}</button>
      <button class="btn ghost" data-act="start:extra">加练 · 再学 ${Math.max(10, S.settings.dailyNew || 15)} 个新词</button>
      <button class="btn ghost sm scope" data-act="open:decks">
        <span>学习范围</span><b>${activeDecks().length}/${TOPICS.length} 个词库 · ${WORDS.filter((w) => activeDecks().indexOf(w.t) >= 0).length} 词</b>
      </button>
      <div class="row2">
        <button class="btn ghost sm" data-act="tab:quiz">快速测验</button>
        <button class="btn ghost sm" data-act="open:wrong">错词本 ${st.wrong.length}</button>
      </div>

      <section class="card">
        <div class="card-head"><span>最近 7 天</span><span>共 ${st.week.reduce((a, b) => a + b.value, 0)} 词</span></div>
        <div class="chart">${week}</div>
      </section>
    </div>`;
  }

  /* ---------- 渲染：学习 ---------- */

  function studyScreen() {
    const s = S.session;
    if (!s) return studyIntro();
    if (s.done) return studySummary();
    const item = s.queue[s.pos];
    const w = WORD_MAP.get(item.w);
    const topic = TOPIC_MAP.get(w.t);
    const isNew = item.kind === 'new';
    const pct = Math.round((s.pos / s.queue.length) * 100);
    const revealed = s.revealed;
    const body = revealed
      ? `<div class="divider"></div>
         <div class="meaning">${esc(w.pos)} ${esc(w.zh)}</div>
         ${w.ex ? `<div class="example">${esc(w.ex)}</div>` : w.def ? `<div class="example en-def">${esc(w.def)}</div>` : ''}`
      : `<div class="hint">先回忆一下，再点开对照</div>`;
    return `<div class="screen">
      <div class="study-head">
        <button class="icon-btn" data-act="pause" aria-label="暂停">←</button>
        <div class="bar-track"><i style="width:${pct}%"></i></div>
        <div class="count">${s.pos + 1}/${s.queue.length}</div>
      </div>

      <section class="flash ${revealed ? '' : 'tappable'}" ${revealed ? '' : 'data-act="reveal"'}>
        <span class="badge ${isNew ? 'new' : 'rev'}">${isNew ? '新词' : '复习'}${topic ? ' · ' + esc(topic.zh) : ''}</span>
        <div class="word">${esc(w.w)}<button class="say" data-act="say:${esc(w.w)}" aria-label="朗读">🔊</button></div>
        ${w.ipa ? `<div class="ipa">${esc(w.ipa)}</div>` : ''}
        ${body}
      </section>

      ${
        revealed
          ? `<div class="grades">
               <button class="grade bad" data-act="grade:again"><b>不认识</b><span>今天再练</span></button>
               <button class="grade warn" data-act="grade:hard"><b>模糊</b><span>明天复习</span></button>
               <button class="grade good" data-act="grade:good"><b>认识</b><span>拉长间隔</span></button>
             </div>
             <button class="linkbtn" data-act="end">结束本组</button>`
          : `<button class="btn primary" data-act="reveal">显示释义</button>`
      }
    </div>`;
  }

  function studyIntro() {
    const st = stats();
    return `<div class="screen">
      <h1>学习</h1>
      <p class="small muted">先复习到期的词，再学新词。每组最多 40 张卡片，按记忆程度自动安排下次复习。</p>
      <div class="chips">
        <div class="chip"><b>${st.due}</b><span>待复习</span></div>
        <div class="chip"><b>${st.newLeft}</b><span>可学新词</span></div>
        <div class="chip"><b>${st.today.total}</b><span>今日已学</span></div>
      </div>
      <button class="btn primary" data-act="start">开始今日学习</button>
      ${st.due > 0 ? `<button class="btn ghost" data-act="start:review">只复习 ${st.due} 个</button>` : ''}
      <button class="btn ghost" data-act="start:extra">加练 · 再学 ${Math.max(10, S.settings.dailyNew || 15)} 个新词</button>
      <h3>四项训练</h3>
      ${trainGrid()}
      <p class="small muted center">记录保存在本机，不会上传。</p>
    </div>`;
  }

  function studySummary() {
    const s = S.session;
    const total = s.results.good + s.results.hard + s.results.again;
    const acc = total ? Math.round((s.results.good / total) * 100) : 0;
    const praise = acc >= 90 ? '记得很稳，继续保持。' : acc >= 70 ? '不错，明天再复习一轮会更牢。' : '别急，重复几次自然会记住。';
    return `<div class="screen">
      <div class="done-hero">
        <div class="check">✓</div>
        <div class="big">${acc}%</div>
        <div class="muted small">本组认识率 · ${praise}</div>
      </div>
      <section class="coach">
        <img class="coach-ava" src="avatar.png" alt="鲸娘">
        <div class="coach-body"><div class="coach-say">${praise}</div></div>
      </section>
      <div class="chips">
        <div class="chip"><b>${s.newCount}</b><span>新词</span></div>
        <div class="chip"><b>${s.reviewCount}</b><span>复习</span></div>
        <div class="chip"><b>${total}</b><span>总卡片</span></div>
      </div>
      <button class="btn primary" data-act="start:extra">再学一组（加练 ${Math.max(10, S.settings.dailyNew || 15)} 个）</button>
      <div class="row2">
        <button class="btn ghost sm" data-act="tab:quiz">去测验</button>
        <button class="btn ghost sm" data-act="tab:today">回今天</button>
      </div>
    </div>`;
  }

  /* ---------- 渲染：测验 ---------- */

  function quizScreen() {
    const q = S.quiz;
    if (!q) return quizSetup();
    if (q.done) return quizResult();
    const item = q.items[q.pos];
    const w = WORD_MAP.get(item.w) || { w: item.w, pos: '', zh: '', ex: '' };
    const last = q.pos + 1 >= q.items.length;
    const kindLabel = item.kind === 'zh' ? '英译中' : item.kind === 'en' ? '中译英'
      : item.kind === 'listen' ? '听音选词' : '拼写';
    const opts = item.options
      .map((label, i) => {
        let cls = 'opt';
        if (q.answered) {
          if (i === item.answer) cls += ' correct';
          else if (i === item.chosen) cls += ' wrong';
          else cls += ' dim';
        }
        return `<button class="${cls}" data-act="quiz:answer:${i}" ${q.answered ? 'disabled' : ''}>
          <span class="k">${'ABCD'[i] || i + 1}</span><span>${esc(label)}</span>
        </button>`;
      })
      .join('');
    const feedback = q.answered
      ? `<div class="feedback ${item.correct ? 'good' : 'bad'}">
           <div class="fb-title">${item.correct ? '答对了' : '正确答案：' + esc(item.options[item.answer])}</div>
           <div class="small muted">${esc(w.pos)} ${esc(w.zh)}<button class="say sm" data-act="say:${esc(w.w)}" aria-label="朗读">🔊</button></div>
           ${w.ex ? `<div class="small muted">${esc(w.ex)}</div>` : w.def ? `<div class="small muted">${esc(w.def)}</div>` : ''}
         </div>
         <button class="btn primary" data-act="quiz:next">${last ? '看结果' : '下一题'}</button>`
      : '';
    return `<div class="screen">
      <div class="study-head">
        <button class="icon-btn" data-act="pause" aria-label="暂停">←</button>
        <div class="bar-track"><i style="width:${Math.round((q.pos / q.items.length) * 100)}%"></i></div>
        <div class="count">${q.pos + 1}/${q.items.length}</div>
      </div>
      ${q.mock ? '<div class="mock-timer" id="mockTimer">15:00</div>' : ''}
      ${item.kind === 'listen'
        ? `<div class="q-prompt listen"><button class="say big" data-act="say:${esc(item.w)}" aria-label="播放">🔊</button></div>`
        : `<div class="q-prompt ${item.kind === 'zh' ? '' : 'zh'}">${esc(item.prompt)}</div>`}
      <div class="q-hint">${esc(item.hint || kindLabel)}</div>
      <div class="opts">${opts}</div>
      ${feedback}
    </div>`;
  }

  function quizSetup() {
    const st = stats();
    const modes = [
      ['zh', '英译中', '看英文选中文释义'],
      ['en', '中译英', '看中文选英文单词'],
      ['spell', '拼写', '看释义选正确拼法'],
      ['listen', '听音选词', '听发音选拼写'],
      ['mix', '混合模式', '五种题型随机出现'],
    ];
    if (st.wrong.length >= 4) modes.push(['wrong', '错词专项', `专练 ${st.wrong.length} 个错词`]);
    return `<div class="screen">
      <h1>测验</h1>
      <p class="small muted">每组 10 题，答完立刻看结果，答错的词会进错词本。</p>
      <div class="modes">
        ${modes
          .map(
            ([k, title, desc]) => `<button class="mode" data-act="quiz:start:${k}">
              <span class="ico">${svg(k === 'spell' ? 'study' : k === 'wrong' ? 'quiz' : 'spark')}</span>
              <span><b>${title}</b><span>${desc}</span></span>
              <span class="arrow">›</span>
            </button>`
          )
          .join('')}
      </div>
      <button class="btn primary" data-act="mock-start">模拟考 · 20 题 / 15 分钟</button>
      <p class="small muted center">模拟考按题型混合出题，交卷后给词汇正确率和 Band 粗估。</p>
    </div>`;
  }

  function quizResult() {
    const q = S.quiz;
    const acc = q.items.length ? Math.round((q.score / q.items.length) * 100) : 0;
    const wrongItems = q.items.filter((x) => x.correct === false);
    const list = wrongItems.length
      ? `<section class="card"><div class="card-head"><span>答错的词</span><span>${wrongItems.length} 个</span></div>
          <div class="list">${wrongItems
            .map((x) => {
              const w = WORD_MAP.get(x.w) || { w: x.w, pos: '', zh: '' };
              return `<div class="list-item"><div><div class="lw">${esc(w.w)}</div><div class="lz">${esc(w.pos)} ${esc(w.zh)}</div></div></div>`;
            })
            .join('')}</div></section>`
      : `<p class="small muted center">全对，状态不错。</p>`;
    return `<div class="screen">
      <div class="done-hero">
        <div class="big">${q.score}<span class="muted" style="font-size:22px"> / ${q.items.length}</span></div>
        <div class="muted small">正确率 ${acc}%</div>
        ${q.mock ? `<div class="band"><b>${bandOf(acc)}</b><span>Band 粗估</span></div>` : ''}
      </div>
      ${q.mock ? '<p class="small muted center">这是词汇正确率换算的粗略参考，不等于真实雅思分数。想准确估分要做完整真题。</p>' : ''}
      ${list}
      <button class="btn primary" data-act="quiz:again">再来一组</button>
      <div class="row2">
        <button class="btn ghost sm" data-act="tab:today">回今天</button>
        <button class="btn ghost sm" data-act="open:wrong">错词本</button>
      </div>
    </div>`;
  }

  /* ---------- 渲染：词库 / 设置 / 错词 ---------- */

  function libraryScreen() {
    const st = stats();
    const pct = st.total ? st.mastered / st.total : 0;
    return `<div class="screen">
      <h1>词库</h1>
      <section class="hero">
        <div class="ring">${ringSVG(pct, 'lib')}<div class="center"><b>${Math.round(pct * 100)}%</b><small>已掌握</small></div></div>
        <div class="hero-info">
          <div class="eyebrow">整体进度</div>
          <div class="hero-num">${st.mastered}<span> / ${st.total} 词</span></div>
          <div class="hero-sub">已学 ${st.seen} 个 · 正确率 ${st.accuracy}%</div>
          <div class="pill">🗂 ${TOPICS.length} 个主题</div>
        </div>
      </section>
      <div class="chips">
        <div class="chip"><b>${st.seen}</b><span>已学</span></div>
        <div class="chip"><b>${st.wrong.length}</b><span>错词</span></div>
        <div class="chip"><b>${st.streak}</b><span>连续天数</span></div>
      </div>
      <section class="card">
        <div class="card-head"><span>主题进度</span><span>掌握 / 总数</span></div>
        <div class="topics">
          ${st.topics
            .map(
              (t) => `<div class="topic tappable" data-act="words:${t.id}">
                <div class="topic-top"><span style="color:var(--text);font-weight:650">${esc(t.zh)}${activeDecks().indexOf(t.id) >= 0 ? '' : ' <span class="off">未选</span>'}</span><span>${t.mastered} / ${t.total} ›</span></div>
                <div class="tbar"><i style="width:${t.total ? Math.round((t.mastered / t.total) * 100) : 0}%"></i></div>
              </div>`
            )
            .join('')}
        </div>
      </section>
      <div class="row3">
        <button class="btn ghost sm" data-act="open:decks">学习范围</button>
        <button class="btn ghost sm" data-act="open:wrong">错词本 ${st.wrong.length}</button>
        <button class="btn ghost sm" data-act="open:settings">设置</button>
      </div>
    </div>`;
  }

  /* ---------- 每日外刊 ---------- */

  let newsBusy = false;

  function newsAge() {
    const t = Date.parse(S.news.fetched || '');
    return isNaN(t) ? Infinity : Date.now() - t;
  }

  function relTime(iso) {
    const t = Date.parse(iso || '');
    if (isNaN(t)) return '';
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 60) return mins <= 1 ? '刚刚' : mins + ' 分钟前';
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + ' 小时前';
    const days = Math.round(hrs / 24);
    return days <= 1 ? '昨天' : days + ' 天前';
  }

  function fetchNews(manual) {
    if (newsBusy) return;
    if (!window.fetch) return;
    newsBusy = true;
    fetch(NEWS_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((j) => {
        const items = Array.isArray(j && j.items) ? j.items : [];
        if (!items.length) throw new Error('empty');
        S.news = { fetched: new Date().toISOString(), generated: j.generated || '', items };
        save();
        newsBusy = false;
        render();
        if (manual) toast('已更新 ' + items.length + ' 篇');
      })
      .catch(() => {
        newsBusy = false;
        render();
        if (manual) toast('外刊更新失败，稍后再试');
      });
  }

  function newsCard(it) {
    const cat = CAT_LABEL[it.cat] || it.cat || '';
    return `<button class="ncard" data-act="news-open:${esc(it.id)}">
      <div class="nrow">
        <span class="ncat c-${esc(it.cat || 'other')}">${esc(cat)}</span>
        <span class="nsrc">${esc(it.src || '')} · ${esc(relTime(it.pub))}</span>
      </div>
      <div class="ntitle">${esc(it.title)}</div>
      ${it.title_zh ? `<div class="ntitle-zh">${esc(it.title_zh)}</div>` : ''}
    </button>`;
  }

  function newsScreen() {
    const items = (S.news && S.news.items) || [];
    const empty = !items.length;
    const head = `<div class="news-head">
      <span>${empty ? '还没有数据' : `${items.length} 篇 · 更新于 ${esc(relTime(S.news.fetched))}`}</span>
      <button class="btn ghost xs" data-act="news-refresh">${newsBusy ? '更新中…' : '刷新'}</button>
    </div>`;
    if (empty) {
      return `<div class="screen">
        <h1>外刊精读</h1>
        ${head}
        <p class="small muted">每天北京时间 07:00 自动抓取科技、财经、生活、文娱各领域的最新英文报道，配中文对照。首次使用需要联网拉取一次。</p>
        <p class="small muted">内容只保存标题与摘要，正文请点原文链接到发布方站点阅读。</p>
      </div>`;
    }
    return `<div class="screen">
      <h1>外刊精读</h1>
      ${head}
      <div class="nlist">${items.map(newsCard).join('')}</div>
      <p class="small muted center">标题与摘要来自各媒体 RSS，版权归原作者；点开可读原文。</p>
    </div>`;
  }

  function newsDetailScreen(id) {
    const items = (S.news && S.news.items) || [];
    const it = items.find((x) => x.id === id);
    if (!it) return newsScreen();
    const cat = CAT_LABEL[it.cat] || it.cat || '';
    return `<div class="screen">
      <div class="nrow">
        <span class="ncat c-${esc(it.cat || 'other')}">${esc(cat)}</span>
        <span class="nsrc">${esc(it.src || '')} · ${esc(relTime(it.pub))}</span>
      </div>
      <h1 class="dtitle">${esc(it.title)}</h1>
      ${it.title_zh ? `<div class="dtitle-zh">${esc(it.title_zh)}</div>` : ''}
      <div class="dblock">
        <div class="dlab">SUMMARY</div>
        <p class="den">${esc(it.summary || '')}</p>
      </div>
      ${it.summary_zh ? `<div class="dblock zh">
        <div class="dlab">中文对照</div>
        <p class="dzh">${esc(it.summary_zh)}</p>
      </div>` : ''}
      <button class="btn primary" data-act="news-src:${esc(it.id)}">读原文</button>
      <button class="btn ghost" data-act="news-back">返回列表</button>
      <p class="small muted center">摘要约 ${it.words || 0} 个英文词</p>
    </div>`;
  }

  /* ---------- 词库选择 / 词表浏览 ---------- */

  let wordsView = { topic: '', q: '', limit: 60 };

  function topicList(id) {
    return WORDS.filter((w) => w.t === id);
  }

  function decksScreen() {
    const picked = new Set(activeDecks());
    const st = stats();
    const rows = TOPICS.map((t) => {
      const total = topicList(t.id).length;
      const row = st.topics.find((x) => x.id === t.id) || { mastered: 0 };
      const on = picked.has(t.id);
      return `<div class="deck ${on ? 'on' : ''}">
        <button class="deck-main" data-act="deck:${t.id}">
          <span class="deck-box">${on ? '✓' : ''}</span>
          <span class="deck-txt"><b>${esc(t.zh)}</b><small>${total} 词 · 已掌握 ${row.mastered}</small></span>
        </button>
        <button class="deck-go" data-act="words:${t.id}">词表 ›</button>
      </div>`;
    }).join('');
    const n = picked.size;
    return `<div class="screen">
      <h1>学习范围</h1>
      <p class="small muted">勾选的词库会进入「今天」「学习」和「测验」；词表随时可以翻阅，不受勾选影响。</p>
      <div class="row2">
        <button class="btn ghost sm" data-act="deck-all">全选 ${TOPICS.length}</button>
        <button class="btn ghost sm" data-act="deck-none">全不选</button>
      </div>
      <section class="card"><div class="decks">${rows}</div></section>
      <p class="small muted center">已选 ${n} / ${TOPICS.length} 个词库 · 共 ${deckWords().length} 词</p>
      <button class="btn primary" data-act="back">完成</button>
    </div>`;
  }

  function wordRow(w) {
    const r = S.words[w.w];
    const state = r && r.seen ? (r.box >= MASTER_BOX ? ' mastered' : ' learning') : '';
    return `<div class="wrow${state}">
      <div class="wrow-top"><b>${esc(w.w)}</b><span class="wipa">${esc(w.ipa || '')}</span></div>
      <div class="wzh">${esc(w.pos || '')} ${esc(w.zh)}</div>
    </div>`;
  }

  function wordsListHTML() {
    const list = topicList(wordsView.topic);
    const q = (wordsView.q || '').trim().toLowerCase();
    const filtered = q ? list.filter((w) => w.w.toLowerCase().indexOf(q) >= 0 || (w.zh || '').indexOf(q) >= 0) : list;
    const shown = filtered.slice(0, wordsView.limit);
    if (!filtered.length) return '<p class="small muted center">没有匹配的词</p>';
    return `<div class="wcount">${q ? '匹配 ' : '共 '}${filtered.length} 词</div>
      <div class="wlist">${shown.map(wordRow).join('')}</div>
      ${filtered.length > shown.length
        ? `<button class="btn ghost sm" data-act="words-more">加载更多（还有 ${filtered.length - shown.length}）</button>`
        : ''}`;
  }

  function renderWordList() {
    const el = document.getElementById('wlist');
    if (el) el.innerHTML = wordsListHTML();
  }

  function wordsScreen(id) {
    const t = TOPIC_MAP.get(id);
    const total = t ? topicList(id).length : 0;
    const st = stats();
    const row = st.topics.find((x) => x.id === id) || { mastered: 0 };
    return `<div class="screen">
      <h1>${esc(t ? t.zh : '词表')}</h1>
      <p class="small muted">共 ${total} 词 · 已掌握 ${row.mastered}${t && t.en ? ' · ' + esc(t.en) : ''}</p>
      <div class="wsearch"><input id="wq" type="search" placeholder="搜索单词或中文释义" value="${esc(wordsView.q || '')}" autocomplete="off" spellcheck="false"></div>
      <div id="wlist">${wordsListHTML()}</div>
      <button class="btn ghost" data-act="open:decks">切换学习范围</button>
    </div>`;
  }

  /* ---------- 同义替换（雅思 paraphrase 训练） ---------- */

  const SYN = [
    ['increase', 'rise'], ['decrease', 'decline'], ['important', 'significant'],
    ['problem', 'issue'], ['benefit', 'advantage'], ['drawback', 'disadvantage'],
    ['difficult', 'challenging'], ['change', 'alter'], ['huge', 'enormous'],
    ['show', 'demonstrate'], ['think', 'believe'], ['help', 'assist'],
    ['need', 'require'], ['buy', 'purchase'], ['get', 'obtain'],
    ['use', 'utilise'], ['begin', 'commence'], ['end', 'conclude'],
    ['enough', 'sufficient'], ['many', 'numerous'], ['famous', 'renowned'],
    ['danger', 'hazard'], ['quick', 'rapid'], ['tired', 'exhausted'],
    ['rich', 'wealthy'], ['poor', 'impoverished'], ['job', 'occupation'],
    ['choose', 'select'], ['main', 'primary'], ['typical', 'typical'],
    ['reduce', 'cut'], ['raise', 'lift'], ['keep', 'maintain'],
    ['build', 'construct'], ['damage', 'harm'], ['repair', 'fix'],
    ['pay', 'compensate'], ['teach', 'instruct'], ['study', 'research'],
    ['worry', 'concern'], ['happy', 'delighted'], ['sad', 'miserable'],
    ['angry', 'furious'], ['cheap', 'affordable'], ['expensive', 'costly'],
    ['modern', 'contemporary'], ['ancient', 'antique'], ['usually', 'generally'],
    ['almost', 'nearly'], ['because', 'since'],
  ].filter(function (x) { return x[0] !== x[1]; });

  function synIntro() {
    return `<div class="screen">
      <h1>同义替换</h1>
      <p class="small muted">雅思阅读和听力的题目几乎从不照抄原文，考的都是同义替换。这组练习就是把这个反射练出来。</p>
      <div class="chips">
        <div class="chip"><b>${SYN.length}</b><span>词组</span></div>
        <div class="chip"><b>10</b><span>每组题</span></div>
      </div>
      <button class="btn primary" data-act="syn-start">开始练习</button>
      <section class="card">
        <div class="card-head"><span>词组预览</span><span>前 20 组</span></div>
        <div class="syn-list">${SYN.slice(0, 20).map(function (p) {
          return `<div class="syn-row"><b>${esc(p[0])}</b><span>≈</span><b>${esc(p[1])}</b></div>`;
        }).join('')}</div>
      </section>
    </div>`;
  }

  function startSynQuiz() {
    const pool = SYN.slice();
    const pairs = shuffle(pool, Math.random).slice(0, 10);
    const items = pairs.map(function (p) {
      const wrongPool = SYN.filter(function (q) { return q[1] !== p[1] && q[0] !== p[0]; });
      const distract = sample(wrongPool, 3).map(function (q) { return q[1]; });
      const opts = shuffle([p[1]].concat(distract), Math.random);
      return {
        w: p[0], kind: 'syn', prompt: p[0], hint: '选出意思最接近的词',
        options: opts, answer: opts.indexOf(p[1]), chosen: null, correct: null,
      };
    });
    S.quiz = { kind: 'syn', items: items, pos: 0, answered: false, score: 0, done: false };
    S.ui.tab = 'quiz';
    S.ui.screen = null;
    save();
    render();
  }

  /* ---------- 口语 Part 2 ---------- */

  const CUE = [
    ['Describe a person who has influenced you.', ['who this person is', 'how you know them', 'what they did', 'and explain why they influenced you']],
    ['Describe a place you like to spend time in.', ['where it is', 'how often you go there', 'what you do there', 'and explain why you like it']],
    ['Describe a skill you learned recently.', ['what the skill is', 'how you learned it', 'how long it took', 'and explain how you felt about it']],
    ['Describe a memorable journey.', ['where you went', 'who you went with', 'what happened', 'and explain why it was memorable']],
    ['Describe an important decision you made.', ['what the decision was', 'when you made it', 'what the alternatives were', 'and explain why it was important']],
    ['Describe a piece of technology you find useful.', ['what it is', 'how you use it', 'how long you have had it', 'and explain why it is useful']],
    ['Describe a book or film that impressed you.', ['what it was about', 'when you read or watched it', 'what was special', 'and explain why it impressed you']],
    ['Describe a time you helped someone.', ['who you helped', 'what the situation was', 'how you helped', 'and explain how you felt']],
    ['Describe a tradition in your country.', ['what it is', 'when it happens', 'who takes part', 'and explain why it matters']],
    ['Describe a goal you want to achieve.', ['what the goal is', 'when you set it', 'what you are doing about it', 'and explain why it matters to you']],
    ['Describe a city you would like to live in.', ['which city it is', 'how you know about it', 'what you would do there', 'and explain why you would like to live there']],
    ['Describe an interesting conversation you had.', ['who you talked to', 'what you talked about', 'where it happened', 'and explain why it was interesting']],
    ['Describe a change in your daily routine.', ['what changed', 'when it changed', 'why it changed', 'and explain how you feel about it']],
    ['Describe something you bought that you are happy with.', ['what it is', 'where you bought it', 'how much it cost', 'and explain why you are happy with it']],
    ['Describe a person who is good at their job.', ['who they are', 'what they do', 'how you know them', 'and explain why they are good at it']],
    ['Describe an occasion when you were late.', ['what the occasion was', 'why you were late', 'what happened', 'and explain how you dealt with it']],
    ['Describe a hobby you enjoy.', ['what the hobby is', 'when you started', 'how often you do it', 'and explain why you enjoy it']],
    ['Describe a piece of advice you received.', ['what the advice was', 'who gave it', 'when you received it', 'and explain whether you followed it']],
  ];

  let speakTimer = null;
  let speakState = { ends: 0, label: '' };

  function cueScreen() {
    return `<div class="screen">
      <h1>口语 Part 2</h1>
      <p class="small muted">Part 2 是给一张话题卡，1 分钟准备、2 分钟独白。选一张卡，按计时器说满两分钟——卡壳也要撑住。</p>
      <div class="cues">
        ${CUE.map(function (c, i) {
          return `<button class="cue" data-act="cue:${i}">
            <b>${esc(c[0])}</b>
            <span>${c[1].length} 个提示点</span>
          </button>`;
        }).join('')}
      </div>
    </div>`;
  }

  function cueDetail(i) {
    const c = CUE[i];
    if (!c) return cueScreen();
    return `<div class="screen">
      <span class="ncat">CUE CARD ${i + 1}</span>
      <h1 class="dtitle">${esc(c[0])}</h1>
      <div class="dblock">
        <div class="dlab">YOU SHOULD SAY</div>
        <ul class="cue-points">${c[1].map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('')}</ul>
      </div>
      <div class="speak-timer" id="speakTimer">--:--</div>
      <button class="btn primary" data-act="cue-prep:${i}">1 分钟准备</button>
      <button class="btn ghost" data-act="cue-talk:${i}">2 分钟作答</button>
      <button class="btn ghost" data-act="back">换一张卡</button>
      <p class="small muted center">说的时候尽量用上你学过的词，别背模板。</p>
    </div>`;
  }

  function runSpeakTimer(seconds, label) {
    speakState = { ends: Date.now() + seconds * 1000, label: label };
    tickSpeak();
    if (speakTimer) clearInterval(speakTimer);
    speakTimer = setInterval(function () {
      if (!document.getElementById('speakTimer')) { clearInterval(speakTimer); speakTimer = null; return; }
      tickSpeak();
    }, 500);
  }

  function tickSpeak() {
    const el = document.getElementById('speakTimer');
    if (!el) return;
    const left = Math.max(0, Math.round((speakState.ends - Date.now()) / 1000));
    el.textContent = (speakState.label ? speakState.label + ' ' : '') + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
    el.classList.toggle('done', left === 0);
  }

  /* ---------- 写作 Task 2 ---------- */

  const WTOPIC = [
    'Some people believe that university education should be free for everyone. To what extent do you agree or disagree?',
    'Governments should spend more money on public transport than on roads. Do you agree or disagree?',
    'Many young people today change jobs frequently. What are the reasons and is this a positive or negative development?',
    'Some argue that technology has made people less social. Discuss both views and give your own opinion.',
    'Should schools teach practical skills like cooking and personal finance instead of traditional subjects?',
    'Environmental protection is often seen as a barrier to economic growth. Discuss both sides.',
    'In many countries, the gap between rich and poor is widening. What problems does this cause and what solutions exist?',
    'Some people think that the best way to reduce crime is to give longer prison sentences. Others believe there are better alternatives.',
    'Advertising aimed at children should be banned. To what extent do you agree?',
    'Remote work is replacing the traditional office. Is this a positive or negative change?',
  ];

  const WPHRASE = [
    ['While it is true that ...', '让步开头，后面接 but 转折，Task 2 最常用的骨架'],
    ['It is often argued that ...', '引出对立观点，比自己"It is said"高级'],
    ['This trend can be attributed to ...', '分析成因，比 "because of" 更有分析味'],
    ['The primary reason for this is ...', '把最重要的原因拎出来，避免罗列'],
    ['A telling example is ...', '举例，比 "for example" 有信息量'],
    ['This does not mean that ...', '限定观点，防止绝对化被扣分'],
    ['Such measures, however, may be difficult to enforce.', '给对策加限定，显示辩证'],
    ['In conclusion, while X offers benefits, Y should not be overlooked.', '结尾两边都收一句，不偏激'],
  ];

  function writingScreen() {
    const drafts = S.writing || {};
    return `<div class="screen">
      <h1>写作 Task 2</h1>
      <p class="small muted">40 分钟写 250 词。先在脑子里过一遍立场和两段论证，再动笔。</p>
      <h3>话题库</h3>
      <div class="cues">
        ${WTOPIC.map(function (t, i) {
          return `<button class="cue" data-act="wtop:${i}">
            <b>${esc(t)}</b>
            <span>${drafts[i] ? '已写 ' + drafts[i].length + ' 字' : '未开始'}</span>
          </button>`;
        }).join('')}
      </div>
      <h3>高频句型</h3>
      <div class="syn-list">
        ${WPHRASE.map(function (p) {
          return `<div class="phr"><b>${esc(p[0])}</b><span>${esc(p[1])}</span></div>`;
        }).join('')}
      </div>
    </div>`;
  }

  function wtopicScreen(i) {
    const t = WTOPIC[i];
    if (!t) return writingScreen();
    const d = (S.writing || {})[i] || '';
    return `<div class="screen">
      <span class="ncat">TASK 2 · ${i + 1}</span>
      <h1 class="dtitle small">${esc(t)}</h1>
      <textarea id="wdraft" class="draft" placeholder="在这里写提纲或全文，只存在本机…">${esc(d)}</textarea>
      <p class="small muted center"><span id="wcount">${d.length}</span> 字符 · 目标 250 词以上</p>
      <button class="btn ghost" data-act="back">返回</button>
    </div>`;
  }

  /* ---------- 阅读题型技巧 ---------- */

  const RTIPS = [
    ['TRUE / FALSE / NOT GIVEN', 'TRUE 是同义改写；FALSE 是明确矛盾；NOT GIVEN 是原文根本没提或无法判断。「没提」和「说反了」是两回事，这是最容易失分的地方。'],
    ['Matching Headings', '先读标题不读选项，抓住每段首句和转折句；先做有把握的，剩下的用排除法。注意段落中间的 however 后面往往是真正的主题。'],
    ['Matching Information', '题目问「哪一段提到 X」，X 常被改写。先扫题干关键词找一个最独特的词（数字、专有名词），再定位。'],
    ['Sentence / Summary Completion', '注意字数限制和语法一致性。填空前先判断所填词性，名词单复数、动词时态都要跟原句匹配。'],
    ['Multiple Choice', '选项越长越可能是原文改写；出现绝对词（all / never / only）通常是错的。四个选项里常有一个是「部分正确但太绝对」。'],
    ['时间分配', '学术类阅读 60 分钟 3 篇 40 题。建议 17 / 20 / 20 分钟，最后一篇留 3 分钟填卡，别在某一道题上超过 2 分钟。'],
  ];

  function readingScreen() {
    return `<div class="screen">
      <h1>阅读技巧</h1>
      <p class="small muted">阅读不是读得越多越快，是知道题目在考什么。这六条是最常被忽略的。</p>
      ${RTIPS.map(function (t) {
        return `<section class="card tip">
          <div class="tip-title">${esc(t[0])}</div>
          <div class="tip-body">${esc(t[1])}</div>
        </section>`;
      }).join('')}
    </div>`;
  }

  /* ---------- 训练入口 ---------- */

  function trainGrid() {
    const items = [
      ['speaking', '口语 Part 2', CUE.length + ' 张话题卡', 'spark'],
      ['writing', '写作 Task 2', WTOPIC.length + ' 个话题', 'study'],
      ['reading', '阅读技巧', RTIPS.length + ' 条', 'library'],
      ['syn', '同义替换', SYN.length + ' 组', 'quiz'],
    ];
    return `<div class="train-grid">
      ${items.map(function (it) {
        return `<button class="train" data-act="open:${it[0]}">
          <span class="ico">${svg(it[3])}</span>
          <b>${it[1]}</b>
          <span>${it[2]}</span>
        </button>`;
      }).join('')}
    </div>`;
  }

  function settingsScreen() {
    const seg = (type, values, current, suffix) =>
      `<div class="seg">${values
        .map(
          (v) =>
            `<button class="seg-item ${v === current ? 'active' : ''}" data-act="set:${type}:${v}">${v}${suffix}</button>`
        )
        .join('')}</div>`;
    const stepper = (type, value, min, max, step, unit) => `<div class="stepper">
        <button class="step-btn" data-act="bump:${type}:-${step}" aria-label="减少">−</button>
        <div class="step-val"><b>${value}</b><span>${unit}</span></div>
        <button class="step-btn" data-act="bump:${type}:${step}" aria-label="增加">＋</button>
      </div>`;
    return `<div class="screen">
      <h1>设置</h1>
      <h3>考试日期</h3>
      <div class="date-row">
        <input id="examDate" type="date" value="${esc(S.settings.examDate || '')}">
        ${S.settings.examDate ? '<button class="icon-btn sm" data-act="clear-exam" aria-label="清除">×</button>' : ''}
      </div>
      <h3>每天新词</h3>
      ${stepper('new', S.settings.dailyNew, 5, 200, 5, '个新词 / 天')}
      ${seg('new', [5, 10, 15, 20, 30], S.settings.dailyNew, '')}
      <h3>每日目标（张卡片）</h3>
      ${stepper('goal', S.settings.dailyGoal, 10, 300, 10, '张卡片 / 天')}
      ${seg('goal', [10, 20, 30, 50], S.settings.dailyGoal, '')}
      <p class="small muted">学完当天配额后，首页还能点「加练」继续学新词，不受配额限制。调整当天即时生效。</p>
      <button class="btn danger" data-act="ask-reset">重置学习进度</button>
      <button class="btn ghost" data-act="back">返回</button>
      <button class="btn ghost" data-act="check-update">检查更新</button>
      <p class="small muted center">${WORDS.length} 词 · ${TOPICS.length} 个主题 · v${esc(APP_VERSION)}</p>
    </div>`;
  }

  function wrongScreen() {
    const st = stats();
    const due = st.wrongDue;
    const total = st.wrong.length;
    if (!total) {
      return `<div class="screen">
        <h1>错词本</h1>
        <p class="small muted">还没有错词。答错或不认识的词会留在这里，按 1/2/4/7/15/30/60 天的间隔安排复习，掌握后自动移出。</p>
        <button class="btn ghost" data-act="back">返回</button>
      </div>`;
    }
    return `<div class="screen">
      <h1>错词本</h1>
      <p class="small muted">答对往后推一档，答错回到第 1 天。每次最多 ${WRONG_BATCH} 个，轮流过一遍，不会总是同一批。</p>
      <div class="chips">
        <div class="chip"><b>${due}</b><span>今天到期</span></div>
        <div class="chip"><b>${total}</b><span>错词总数</span></div>
        <div class="chip"><b>${total - due}</b><span>未到期</span></div>
      </div>
      <button class="btn primary" data-act="wrong-quiz" ${due < 4 && total < 4 ? 'disabled' : ''}>
        ${due >= 4 ? `复习到期 ${Math.min(due, WRONG_BATCH)} 个${due > WRONG_BATCH ? '（共 ' + due + '）' : ''}` : '先过一遍错词'}
      </button>
      <button class="btn ghost" data-act="wrong-quiz-all" ${total < 4 ? 'disabled' : ''}>全部过一遍（${total} 个）</button>
      <section class="card">
        <div class="card-head"><span>错词清单</span><span>下次复习</span></div>
        <div class="list">${st.wrong
          .slice(0, 50)
          .map((x) => {
            const r = wrongRec(x.w) || {};
            const d = String(r.wdue || today());
            const tag = d <= today() ? '今天' : d.slice(5).replace('-', '/');
            return `<div class="list-item"><div><div class="lw">${esc(x.w)}</div><div class="lz">${esc(x.pos)} ${esc(x.zh)}</div></div><div class="lt">错 ${x.count} 次 · ${esc(tag)}</div></div>`;
          })
          .join('')}</div>
        ${total > 50 ? '<p class="small muted center">只列出前 50 个</p>' : ''}
      </section>
      <button class="btn danger" data-act="ask-clear">清空错词记录</button>
      <button class="btn ghost" data-act="back">返回</button>
    </div>`;
  }

  function modalHTML() {
    if (!S.ui.confirm) return '';
    const reset = S.ui.confirm === 'reset';
    return `<div class="sheet-backdrop">
      <div class="sheet">
        <h3>${reset ? '重置学习进度？' : '清空错词记录？'}</h3>
        <p>${reset ? '所有单词的记忆记录、打卡和错词都会被清空，设置会保留。此操作不能撤销。' : '错词本会清空，但已经学会的单词和每日记录不受影响。'}</p>
        <button class="btn ${reset ? 'danger' : 'danger'}" data-act="${reset ? 'reset' : 'clear-wrong'}">${reset ? '确认重置' : '确认清空'}</button>
        <button class="btn ghost" data-act="cancel">取消</button>
      </div>
    </div>`;
  }

  /* ---------- 主渲染 ---------- */

  function backTarget(screen) {
    if (typeof screen !== 'string') return null;
    if (screen.indexOf('cue:') === 0) return 'speaking';
    if (screen.indexOf('wtop:') === 0) return 'writing';
    if (screen.indexOf('words:') === 0) return null;
    return null;
  }

  function screenHTML() {
    if (S.ui.screen === 'settings') return settingsScreen();
    if (S.ui.screen === 'decks') return decksScreen();
    if (S.ui.screen === 'speaking') return cueScreen();
    if (S.ui.screen === 'syn') return synIntro();
    if (S.ui.screen === 'writing') return writingScreen();
    if (S.ui.screen === 'reading') return readingScreen();
    if (typeof S.ui.screen === 'string' && S.ui.screen.indexOf('cue:') === 0) return cueDetail(Number(S.ui.screen.slice(4)));
    if (typeof S.ui.screen === 'string' && S.ui.screen.indexOf('wtop:') === 0) return wtopicScreen(Number(S.ui.screen.slice(5)));
    if (typeof S.ui.screen === 'string' && S.ui.screen.indexOf('words:') === 0) return wordsScreen(S.ui.screen.slice(6));
    if (S.ui.screen === 'wrong') return wrongScreen();
    if (S.ui.tab === 'study') return studyScreen();
    if (S.ui.tab === 'quiz') return quizScreen();
    if (S.ui.tab === 'news') {
      const sc = S.ui.screen;
      if (typeof sc === 'string' && sc.indexOf('news:') === 0) return newsDetailScreen(sc.slice(5));
      return newsScreen();
    }
    if (S.ui.tab === 'library') return libraryScreen();
    return todayScreen();
  }

  function tickMock() {
    const q = S.quiz;
    const el = document.getElementById('mockTimer');
    if (!q || !q.mock || q.done) return;
    const left = Math.max(0, Math.round((q.ends - Date.now()) / 1000));
    if (el) el.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
    if (left <= 0) {
      q.done = true;
      save();
      render();
    }
  }

  setInterval(function () {
    if (S.quiz && S.quiz.mock && !S.quiz.done) tickMock();
  }, 1000);

  function render() {
    document.getElementById('topbar').innerHTML = topbarHTML();
    const view = document.getElementById('view');
    const focus =
      (S.ui.tab === 'study' && S.session && !S.session.done) ||
      (S.ui.tab === 'quiz' && S.quiz && !S.quiz.done);
    view.className = 'view' + (focus ? ' no-tabs' : '');
    view.innerHTML = screenHTML() + modalHTML();
    document.getElementById('tabbar').innerHTML = focus ? '' : tabbarHTML();
    if (S.quiz && !S.quiz.done && !S.quiz.answered) {
      const it = S.quiz.items[S.quiz.pos];
      if (it && it.kind === 'listen') speak(it.w);
    }
    tickMock();
    save();
  }

  /* ---------- 交互 ---------- */

  function doReset() {
    S.words = {};
    S.days = {};
    S.session = null;
    S.quiz = null;
    S.lastSession = null;
    S.ui.confirm = null;
    save();
    render();
    toast('学习进度已清空');
  }

  function doClearWrong() {
    for (const r of Object.values(S.words)) r.wrong = 0;
    S.ui.confirm = null;
    save();
    render();
    toast('错词记录已清空');
  }

  document.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'examDate') {
      S.settings.examDate = e.target.value || '';
      save();
      return;
    }
    if (e.target && e.target.id === 'wdraft') {
      S.writing = S.writing || {};
      S.writing[S.ui.screen.slice(5)] = e.target.value;
      const c = document.getElementById('wcount');
      if (c) c.textContent = String(e.target.value.length);
      save();
      return;
    }
    if (!e.target || e.target.id !== 'wq') return;
    wordsView.q = e.target.value;
    wordsView.limit = 60;
    renderWordList();
  });

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const parts = el.dataset.act.split(':');
    const act = parts[0];
    const arg = parts[1];
    switch (act) {
      case 'tab':
        S.ui.tab = arg;
        S.ui.screen = null;
        S.ui.confirm = null;
        save();
        render();
        window.scrollTo(0, 0);
        if (arg === 'news' && ((S.news && S.news.items || []).length === 0 || newsAge() > NEWS_TTL)) fetchNews(false);
        break;
      case 'back':
        S.ui.screen = backTarget(S.ui.screen);
        S.ui.confirm = null;
        save();
        render();
        break;
      case 'pause':
        S.ui.tab = 'today';
        save();
        render();
        window.scrollTo(0, 0);
        break;
      case 'start':
        beginStudy(arg || 'daily');
        break;
      case 'reveal':
        if (S.session && !S.session.done) {
          S.session.revealed = true;
          save();
          render();
        }
        break;
      case 'grade':
        grade(arg);
        break;
      case 'end':
        S.session = null;
        S.ui.tab = 'today';
        save();
        render();
        break;
      case 'apply-plan': {
        const p = planInfo();
        if (!p) break;
        S.settings.dailyNew = Math.max(5, Math.min(200, p.perDay));
        save();
        render();
        toast('已设为每天 ' + S.settings.dailyNew + ' 个新词');
        break;
      }
      case 'clear-exam':
        S.settings.examDate = '';
        save();
        render();
        break;
      case 'syn-start':
        startSynQuiz();
        break;
      case 'cue': {
        S.ui.screen = 'cue:' + arg;
        save();
        render();
        window.scrollTo(0, 0);
        break;
      }
      case 'cue-prep':
      case 'cue-talk':
        runSpeakTimer(act === 'cue-prep' ? 60 : 120, act === 'cue-prep' ? '准备' : '作答');
        break;
      case 'wtop': {
        S.ui.screen = 'wtop:' + arg;
        save();
        render();
        window.scrollTo(0, 0);
        break;
      }
      case 'say':
        speak(parts.slice(1).join(':'));
        break;
      case 'mock-start':
        startMock();
        break;
      case 'quiz':
        if (arg === 'start') startQuiz(parts[2]);
        else if (arg === 'answer') answerQuiz(Number(parts[2]));
        else if (arg === 'next') nextQuestion();
        else if (arg === 'again') {
          S.quiz = null;
          save();
          render();
        }
        break;
      case 'wrong-quiz':
        startQuiz('wrong');
        break;
      case 'wrong-quiz-all':
        startQuiz('wrong-all');
        break;
      case 'open':
        S.ui.screen = arg;
        S.ui.confirm = null;
        save();
        render();
        window.scrollTo(0, 0);
        break;
      case 'set':
        if (arg === 'new') S.settings.dailyNew = Number(parts[2]);
        if (arg === 'goal') S.settings.dailyGoal = Number(parts[2]);
        save();
        render();
        break;
      case 'bump': {
        const dir = Number(parts[2]) || 0;
        if (arg === 'new') S.settings.dailyNew = Math.max(5, Math.min(200, (S.settings.dailyNew || 15) + dir));
        if (arg === 'goal') S.settings.dailyGoal = Math.max(10, Math.min(300, (S.settings.dailyGoal || 20) + dir));
        save();
        render();
        break;
      }
      case 'ask-reset':
        S.ui.confirm = 'reset';
        render();
        break;
      case 'ask-clear':
        S.ui.confirm = 'clear';
        render();
        break;
      case 'cancel':
        S.ui.confirm = null;
        render();
        break;
      case 'reset':
        doReset();
        break;
      case 'clear-wrong':
        doClearWrong();
        break;
      case 'update':
        if (S.update && window.App && window.App.installUpdate) {
          updateState = 'downloading';
          render();
          window.App.installUpdate(S.update.url);
        } else {
          toast('请在浏览器打开 GitHub 页面下载');
        }
        break;
      case 'update-later':
        S.seenUpdate = S.update ? S.update.version : '';
        updateState = '';
        save();
        render();
        break;
      case 'deck': {
        const cur = activeDecks().slice();
        const i = cur.indexOf(arg);
        if (i >= 0) cur.splice(i, 1); else cur.push(arg);
        S.settings.decks = TOPICS.map((t) => t.id).filter((id) => cur.indexOf(id) >= 0);
        save();
        render();
        break;
      }
      case 'deck-all':
        S.settings.decks = TOPICS.map((t) => t.id);
        save();
        render();
        break;
      case 'deck-none':
        S.settings.decks = [];
        save();
        render();
        break;
      case 'words':
        wordsView = { topic: arg, q: '', limit: 60 };
        S.ui.screen = 'words:' + arg;
        S.ui.confirm = null;
        save();
        render();
        window.scrollTo(0, 0);
        break;
      case 'words-more':
        wordsView.limit += 60;
        renderWordList();
        break;
      case 'news-refresh':
        toast('正在拉取最新外刊…');
        fetchNews(true);
        break;
      case 'news-open':
        S.ui.screen = 'news:' + arg;
        save();
        render();
        window.scrollTo(0, 0);
        break;
      case 'news-back':
        S.ui.screen = null;
        save();
        render();
        break;
      case 'news-src': {
        const it = ((S.news && S.news.items) || []).find((x) => x.id === arg);
        if (!it) break;
        if (window.App && window.App.openUrl) window.App.openUrl(it.url);
        else toast('请在浏览器打开：' + it.url);
        break;
      }
      case 'check-update':
        toast('正在检查更新…');
        checkUpdate(true);
        break;
      default:
        break;
    }
  });

  window.addEventListener('load', render);
  render();
  setTimeout(function () { checkUpdate(false); }, 1500);
  setTimeout(function () { if (newsAge() > NEWS_TTL) fetchNews(false); }, 3500);

  // 系统返回键：先关弹层/子页，再回今天，最后才退出
  window.__ieltsBack = function () {
    if (S.ui.confirm) {
      S.ui.confirm = null;
      render();
      return true;
    }
    if (S.ui.screen) {
      S.ui.screen = backTarget(S.ui.screen);
      render();
      return true;
    }
    if (S.ui.tab !== 'today') {
      S.ui.tab = 'today';
      render();
      return true;
    }
    return false;
  };

  // 方便排查/测试
  window.__ielts = {
    state: () => S,
    stats,
    buildQueue,
    startQuiz,
  };
})();
