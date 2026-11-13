const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const { inlineHtml } = require('./inline.js');
const feed = JSON.parse(fs.readFileSync(path.join(root, 'data/articles.json'), 'utf8'));
const JUNK_RE = /sudoku|crossword|cross-word|wordle|\bpuzzle\b|cryptic crossword/i;
const shown = [];
const seenUrl = new Set();
feed.items.forEach((it) => {
  const blob = it.title + ' ' + (it.summary || '') + ' ' + it.url;
  if (JUNK_RE.test(blob)) return;
  const key = String(it.url).split('?')[0].toLowerCase();
  if (seenUrl.has(key)) return;
  seenUrl.add(key);
  shown.push(it);
});

function boot({ data = feed, fail = false } = {}) {
  const calls = [];
  const errors = [];
  const html = inlineHtml(root);
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://ielts.local/',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.addEventListener('error', (e) => errors.push(e.message));
      window.App = {
        version: () => '1.4.0',
        installUpdate: () => {},
        openUrl: (u) => calls.push(u),
        platform: () => 'android',
      };
      window.fetch = (url) => {
        if (String(url).includes('articles.json')) {
          if (fail) return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
          return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
        }
        return new Promise(() => {});
      };
    },
  });
  return { window: dom.window, doc: dom.window.document, calls, errors, dom };
}

const text = (d) => d.getElementById('view').textContent.replace(/\s+/g, ' ').trim();
const click = (w, sel) => {
  const el = w.document.querySelector(sel);
  if (!el) throw new Error('missing: ' + sel);
  el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
};
const assert = (c, m) => {
  if (!c) throw new Error('ASSERT: ' + m);
  console.log('ok  ' + m);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  try {
    // 1. 空状态 + 自动拉取
    let t = boot();
    await sleep(4000); // 等启动后的自动拉取（3.5s）
    let view = text(t.doc);
    assert(t.doc.querySelectorAll('.tab').length === 4, '底部有 4 个标签');
    assert(t.doc.getElementById('tabbar').textContent.includes('首页'), '首页在标签栏');
    assert(!t.doc.getElementById('tabbar').textContent.includes('外刊'), '外刊不占底部标签');

    click(t.window, '[data-act="tab:study"]');
    click(t.window, '[data-act="tab:news"]');
    view = text(t.doc);
    assert(view.includes('外刊精读'), '进入外刊列表');
    assert(t.doc.querySelectorAll('.ncard').length === shown.length, '列表渲染过滤后的 ' + shown.length + ' 篇');
    assert(view.indexOf('Sudoku') < 0 && view.indexOf('crossword') < 0, '数独和填字游戏不进列表');
    assert(view.includes(feed.items[0].title.slice(0, 18)), '显示英文标题');
    assert(view.includes(feed.items[0].title_zh.slice(0, 8)), '显示中文标题');
    assert(/更新于/.test(view), '显示更新时间');

    // 2. 打开详情
    click(t.window, '.ncard');
    view = text(t.doc);
    const it = feed.items[0];
    assert(view.includes('SUMMARY'), '详情有英文摘要区');
    assert(view.includes('中文对照'), '详情有中文对照区');
    assert(view.includes(it.summary_zh.slice(0, 10)), '中文摘要内容正确');
    assert(/摘要约 \d+ 个英文词/.test(view), '显示词数');

    // 3. 读原文调用原生
    click(t.window, '[data-act^="news-src:"]');
    assert(t.calls.length === 1 && t.calls[0] === it.url, '读原文调用了 openUrl 并传入原文地址');

    // 4. 返回列表
    click(t.window, '[data-act="news-back"]');
    assert(text(t.doc).includes('外刊精读') && t.doc.querySelectorAll('.ncard').length === shown.length, '返回到列表');

    // 5. 刷新
    click(t.window, '[data-act="news-refresh"]');
    await sleep(300);
    assert(t.doc.querySelectorAll('.ncard').length === shown.length, '刷新后仍是过滤后的篇数');

    // 6. 失败降级
    const t2 = boot({ fail: true });
    await sleep(500);
    click(t2.window, '[data-act="tab:study"]');
    click(t2.window, '[data-act="tab:news"]');
    await sleep(500);
    assert(text(t2.doc).includes('还没有数据'), '拉取失败时给出空状态');
    assert(t2.errors.length === 0, '无运行时错误');

    // 7. 缓存命中（不再重复请求）
    const t3 = boot();
    await sleep(4000);
    const before = t3.doc.querySelectorAll('.ncard').length;
    click(t3.window, '[data-act="tab:study"]');
    click(t3.window, '[data-act="tab:news"]');
    assert(before === 0 && t3.doc.querySelectorAll('.ncard').length === shown.length, '切换标签时按需拉取并渲染');

    console.log('\nNEWS TEST PASS');
    process.exit(0);
  } catch (e) {
    console.error('\nFAIL:', e.message);
    process.exit(1);
  }
})();
