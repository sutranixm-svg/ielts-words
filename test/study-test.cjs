const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
const words = fs.readFileSync(path.join(root, 'web/words.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'web/app.js'), 'utf8');
html = html
  .replace('<script src="words.js"></script>', '<script>' + words + '</script>')
  .replace('<script src="app.js"></script>', '<script>' + app + '</script>');

const errors = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://ielts.local/',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.scrollTo = () => {};
    window.addEventListener('error', (e) => errors.push(e.message));
    window.fetch = () => new Promise(() => {});
    window.App = { version: () => '1.5.0', installUpdate: () => {}, openUrl: () => {}, platform: () => 'android' };
  },
});
const { window } = dom;
const doc = window.document;
const click = (sel) => {
  const el = doc.querySelector(sel);
  if (!el) throw new Error('missing: ' + sel);
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
};
const text = () => doc.getElementById('view').textContent.replace(/\s+/g, ' ').trim();
const assert = (c, m) => {
  if (!c) throw new Error('ASSERT: ' + m);
  console.log('ok  ' + m);
};
const S = () => window.__ielts.state();
const pad = (n) => String(n).padStart(2, '0');
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dstr(d); };
const today = dstr(new Date());

setTimeout(() => {
  try {
    /* ---------- 1. 学习量可调 ---------- */
    click('[data-act="tab:library"]');
    click('[data-act="open:settings"]');
    assert(text().includes('每天新词'), '设置页有学习量设置');
    const before = S().settings.dailyNew;
    click('[data-act="bump:new:5"]');
    assert(S().settings.dailyNew === before + 5, `步进 +5：${before} → ${S().settings.dailyNew}`);
    click('[data-act="bump:new:-5"]');
    assert(S().settings.dailyNew === before, '步进 −5 复原');
    for (let i = 0; i < 60; i += 1) click('[data-act="bump:new:5"]');
    assert(S().settings.dailyNew === 200, '上限 200 封顶');
    click('[data-act="set:new:20"]');
    assert(S().settings.dailyNew === 20, '快捷档位仍然可用');

    /* ---------- 2. 配额之外还能继续学 ---------- */
    click('[data-act="back"]');
    click('[data-act="tab:today"]');
    assert(text().includes('加练'), '首页有加练入口');
    // 学满今天的 20 个新词
    const q = window.__ielts.buildQueue('new');
    assert(q.queue.length === 20, '今日新词队列 = 20（跟设置一致）');
    const st = S();
    q.queue.forEach((item, i) => {
      st.words[item.w] = { box: 1, due: addDays(1), seen: 1, right: 1, wrong: 0, first: today, last: today };
      st.days[today] = st.days[today] || { new: 0, review: 0, right: 0, wrong: 0 };
      st.days[today].new += 1;
    });
    assert(window.__ielts.buildQueue('daily').newCount === 0, '配额用完后 daily 不再给新词');
    assert(window.__ielts.buildQueue('extra').newCount === 20, '加练仍给 20 个新词（可继续往后学）');

    /* ---------- 3. 艾宾浩斯错词 ---------- */
    const st2 = S();
    const picked = window.WORDS.slice(0, 30);
    picked.forEach((w) => {
      st2.words[w.w] = { box: 0, due: today, seen: 1, right: 0, wrong: 2, first: today, last: today, wstep: 0, wdue: today, wlast: null };
    });
    click('[data-act="open:wrong"]');
    let view = text();
    assert(view.includes('今天到期'), '错词本显示到期数');
    assert(view.includes('30'), '错词总数 30');
    assert(view.includes('复习到期 20 个（共 30）'), '一次最多 20 个');

    // 第一轮：全部答对
    click('[data-act="wrong-quiz"]');
    let quiz = S().quiz;
    assert(quiz.items.length === 20, '第一轮出 20 题');
    const round1 = quiz.items.map((x) => x.w);
    assert(new Set(round1).size === 20, '第一轮 20 个不重复');
    for (let i = 0; i < 20; i += 1) {
      const ans = S().quiz.items[S().quiz.pos].answer;
      click(`[data-act="quiz:answer:${ans}"]`);
      click('[data-act="quiz:next"]');
    }
    const recAdv = S().words[round1[0]];
    assert(recAdv.wstep === 1, '答对后间隔档位 +1');
    assert(recAdv.wdue === addDays(2), '答对后下次复习推后到 2 天后（wdue=' + recAdv.wdue + '）');

    click('[data-act="quiz:again"]');
    click('[data-act="tab:today"]');
    click('[data-act="open:wrong"]');
    view = text();
    assert(window.__ielts.stats().wrongDue === 10, '答对后到期数降到 10（实际 ' + window.__ielts.stats().wrongDue + '）');

    // 第二轮：应该是另外 10 个，不是重复同一批
    click('[data-act="wrong-quiz"]');
    quiz = S().quiz;
    const round2 = quiz.items.map((x) => x.w);
    assert(round2.length === 10, '第二轮出剩下的 10 个');
    assert(round2.every((w) => round1.indexOf(w) < 0), '第二轮不再重复第一轮的词（覆盖到新的）');

    // 答错要回到第 1 天
    for (let i = 0; i < 10; i += 1) {
      const qq = S().quiz.items[S().quiz.pos];
      const wrongIdx = (qq.answer + 1) % 4;
      click(`[data-act="quiz:answer:${wrongIdx}"]`);
      click('[data-act="quiz:next"]');
    }
    const recReset = S().words[round2[0]];
    assert(recReset.wstep === 0, '答错后回到第 1 档');
    assert(recReset.wdue === addDays(1), '答错后明天再复习（wdue=' + recReset.wdue + '）');

    // 全部过一遍
    click('[data-act="quiz:again"]');
    click('[data-act="tab:today"]');
    click('[data-act="open:wrong"]');
    click('[data-act="wrong-quiz-all"]');
    assert(S().quiz.items.length === 20, '全部过一遍也能覆盖（单轮 20）');

    assert(errors.length === 0, '无运行时错误' + (errors.length ? ': ' + errors.join(' | ') : ''));
    console.log('\nSTUDY TEST PASS');
    window.close();
    process.exit(0);
  } catch (e) {
    console.error('\nFAIL:', e.message);
    console.error('errors:', errors);
    process.exit(1);
  }
}, 300);
