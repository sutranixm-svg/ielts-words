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
  const KINDS = ['zh', 'en', 'spell'];
  const REPO = 'sutranixm-svg/ielts-words';
  const RELEASES_API = 'https://api.github.com/repos/' + REPO + '/releases/latest';
  const APP_VERSION = (window.App && window.App.version && window.App.version()) || '0';

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
      settings: { dailyNew: 15, dailyGoal: 20 },
      session: null,
      quiz: null,
      lastSession: null,
      update: null,
      seenUpdate: '',
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
      S.words[w] = { box: 0, due: today(), seen: 0, right: 0, wrong: 0, first: today(), last: null };
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
    }
    if (first) rec.first = day;
    return rec;
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
    const total = WORDS.length;
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
    const due = WORDS.filter((w) => {
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
    const unseen = WORDS.filter((w) => !S.words[w.w] || !S.words[w.w].seen);
    const newPicked = shuffle(unseen, rnd).slice(0, mode === 'extra' ? 10 : cap);

    if (mode === 'review') return { queue: due.map((w) => ({ w: w.w, kind: 'review' })), newCount: 0, reviewCount: due.length };
    if (mode === 'new' || mode === 'extra') return { queue: newPicked.map((w) => ({ w: w.w, kind: 'new' })), newCount: newPicked.length, reviewCount: 0 };
    if (mode === 'drill') {
      const seen = WORDS.filter((w) => S.words[w.w] && S.words[w.w].seen);
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
      toast(mode === 'review' ? '还没有到期的复习词' : '今天没有要学的词了，先测验一下吧');
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
    const safePool = pool.length >= 4 ? pool : WORDS;
    if (kind === 'zh') {
      const others = sample(safePool.filter((w) => w.w !== word.w && w.zh !== word.zh), 3);
      const opts = shuffle([word.zh, ...others.map((w) => w.zh)]);
      return { w: word.w, kind, prompt: word.w, hint: '', options: opts, answer: opts.indexOf(word.zh), chosen: null, correct: null };
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
    const seen = WORDS.filter((w) => S.words[w.w] && S.words[w.w].seen);
    let pool;
    let picked;
    if (kind === 'wrong') {
      pool = WORDS.filter((w) => {
        const r = S.words[w.w];
        return r && r.seen && r.wrong > 0 && r.box < MASTER_BOX;
      });
      picked = sample(pool, Math.min(10, pool.length));
      if (picked.length < 4) {
        toast('错词不足 4 个，先做普通测验吧');
        return;
      }
    } else {
      pool = seen.length >= 10 ? seen : WORDS;
      picked = sample(pool, Math.min(10, pool.length));
      if (picked.length < 4) {
        toast('词库太小，先学几个词吧');
        return;
      }
    }
    const items = picked.map((w, i) => {
      let k = kind;
      if (kind === 'mix') k = KINDS[Math.floor(Math.random() * KINDS.length)];
      if (kind === 'wrong') k = i % 2 === 0 ? 'zh' : 'en';
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
    if (rec && rec.seen) applyGrade(rec, item.correct ? 'good' : 'again');
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
    const tabs = [
      ['today', '今天'],
      ['study', '学习'],
      ['quiz', '测验'],
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
    return `<div class="screen">
      ${updateBanner()}
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
         ${w.ex ? `<div class="example">${esc(w.ex)}</div>` : ''}`
      : `<div class="hint">先回忆一下，再点开对照</div>`;
    return `<div class="screen">
      <div class="study-head">
        <button class="icon-btn" data-act="pause" aria-label="暂停">←</button>
        <div class="bar-track"><i style="width:${pct}%"></i></div>
        <div class="count">${s.pos + 1}/${s.queue.length}</div>
      </div>

      <section class="flash ${revealed ? '' : 'tappable'}" ${revealed ? '' : 'data-act="reveal"'}>
        <span class="badge ${isNew ? 'new' : 'rev'}">${isNew ? '新词' : '复习'}${topic ? ' · ' + esc(topic.zh) : ''}</span>
        <div class="word">${esc(w.w)}</div>
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
      <button class="btn primary" data-act="start">再学一组</button>
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
    const w = WORD_MAP.get(item.w);
    const last = q.pos + 1 >= q.items.length;
    const kindLabel = item.kind === 'zh' ? '英译中' : item.kind === 'en' ? '中译英' : '拼写';
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
           <div class="small muted">${esc(w.pos)} ${esc(w.zh)}</div>
           ${w.ex ? `<div class="small muted">${esc(w.ex)}</div>` : ''}
         </div>
         <button class="btn primary" data-act="quiz:next">${last ? '看结果' : '下一题'}</button>`
      : '';
    return `<div class="screen">
      <div class="study-head">
        <button class="icon-btn" data-act="pause" aria-label="暂停">←</button>
        <div class="bar-track"><i style="width:${Math.round((q.pos / q.items.length) * 100)}%"></i></div>
        <div class="count">${q.pos + 1}/${q.items.length}</div>
      </div>
      <div class="q-prompt ${item.kind === 'zh' ? '' : 'zh'}">${esc(item.prompt)}</div>
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
      ['mix', '混合模式', '三种题型随机出现'],
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
      <p class="small muted center">不会的题会重复出现，直到你记住为止。</p>
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
              const w = WORD_MAP.get(x.w);
              return `<div class="list-item"><div><div class="lw">${esc(w.w)}</div><div class="lz">${esc(w.pos)} ${esc(w.zh)}</div></div></div>`;
            })
            .join('')}</div></section>`
      : `<p class="small muted center">全对，状态不错。</p>`;
    return `<div class="screen">
      <div class="done-hero">
        <div class="big">${q.score}<span class="muted" style="font-size:22px"> / ${q.items.length}</span></div>
        <div class="muted small">正确率 ${acc}%</div>
      </div>
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
              (t) => `<div class="topic">
                <div class="topic-top"><span style="color:var(--text);font-weight:650">${esc(t.zh)}</span><span>${t.mastered} / ${t.total}</span></div>
                <div class="tbar"><i style="width:${t.total ? Math.round((t.mastered / t.total) * 100) : 0}%"></i></div>
              </div>`
            )
            .join('')}
        </div>
      </section>
      <div class="row2">
        <button class="btn ghost sm" data-act="open:wrong">错词本 ${st.wrong.length}</button>
        <button class="btn ghost sm" data-act="open:settings">设置</button>
      </div>
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
    return `<div class="screen">
      <h1>设置</h1>
      <h3>每天新词</h3>
      ${seg('new', [5, 10, 15, 20, 30], S.settings.dailyNew, '')}
      <h3>每日目标（张卡片）</h3>
      ${seg('goal', [10, 20, 30, 50], S.settings.dailyGoal, '')}
      <p class="small muted">调整后从下一组开始生效。学习记录只保存在这台手机上。</p>
      <button class="btn danger" data-act="ask-reset">重置学习进度</button>
      <button class="btn ghost" data-act="back">返回</button>
      <button class="btn ghost" data-act="check-update">检查更新</button>
      <p class="small muted center">${WORDS.length} 词 · ${TOPICS.length} 个主题 · v${esc(APP_VERSION)}</p>
    </div>`;
  }

  function wrongScreen() {
    const st = stats();
    if (!st.wrong.length) {
      return `<div class="screen">
        <h1>错词本</h1>
        <p class="small muted">还没有错词。答错或不认识的词会留在这里，掌握后自动移出。</p>
        <button class="btn ghost" data-act="back">返回</button>
      </div>`;
    }
    return `<div class="screen">
      <h1>错词本</h1>
      <p class="small muted">答错或不认识的词会留在这里，连续答对、掌握后自动移出。</p>
      <section class="card">
        <div class="list">${st.wrong
          .slice(0, 40)
          .map(
            (x) =>
              `<div class="list-item"><div><div class="lw">${esc(x.w)}</div><div class="lz">${esc(x.pos)} ${esc(x.zh)}</div></div><div class="lt">错 ${x.count} 次</div></div>`
          )
          .join('')}</div>
      </section>
      <button class="btn primary" data-act="wrong-quiz">复习这些错词</button>
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

  function screenHTML() {
    if (S.ui.screen === 'settings') return settingsScreen();
    if (S.ui.screen === 'wrong') return wrongScreen();
    if (S.ui.tab === 'study') return studyScreen();
    if (S.ui.tab === 'quiz') return quizScreen();
    if (S.ui.tab === 'library') return libraryScreen();
    return todayScreen();
  }

  function render() {
    document.getElementById('topbar').innerHTML = topbarHTML();
    const view = document.getElementById('view');
    const focus =
      (S.ui.tab === 'study' && S.session && !S.session.done) ||
      (S.ui.tab === 'quiz' && S.quiz && !S.quiz.done);
    view.className = 'view' + (focus ? ' no-tabs' : '');
    view.innerHTML = screenHTML() + modalHTML();
    document.getElementById('tabbar').innerHTML = focus ? '' : tabbarHTML();
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
        break;
      case 'back':
        S.ui.screen = null;
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

  // 系统返回键：先关弹层/子页，再回今天，最后才退出
  window.__ieltsBack = function () {
    if (S.ui.confirm) {
      S.ui.confirm = null;
      render();
      return true;
    }
    if (S.ui.screen) {
      S.ui.screen = null;
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
