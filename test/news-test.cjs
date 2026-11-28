const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const { inlineHtml } = require('./inline.js');
const feed = JSON.parse(fs.readFileSync(path.join(root, 'data/articles.json'), 'utf8'));
let shown = [];

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
    shown = t.window.__ielts.cleanArticles(feed.items);
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
    assert(view.indexOf('Black Friday') < 0 && view.toLowerCase().indexOf('spoiler alert') < 0, '购物清单和剧透不进列表');
    assert(view.includes(feed.items[0].title.slice(0, 18)), '显示英文标题');
    assert(view.includes(feed.items[0].title_zh.slice(0, 8)), '显示中文标题');
    assert(/更新于/.test(view), '显示更新时间');

    // 2. 打开详情
    click(t.window, '.ncard');
    view = text(t.doc);
    const it = shown[0];
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

    // 8. 实体、购物清单和剧透
    const mixed = {
      generated: '2026-11-27T00:00:00Z',
      items: [
        { id: 'bf', cat: 'life', src: 'Shop', title: 'Best Black Friday deals', title_zh: '黑色星期五', summary: 'Towels on sale', summary_zh: '浴巾打折', url: 'https://example.com/bf', pub: '2026-11-27T03:00:00Z' },
        { id: 'sp', cat: 'culture', src: 'TV', title: 'The finale', title_zh: '大结局', summary: 'Spoiler alert: everyone leaves.', summary_zh: '剧透', url: 'https://example.com/sp', pub: '2026-11-27T02:00:00Z' },
        { id: 'uni', cat: 'tech', src: 'BBC', title: 'Universities cut emissions', title_zh: '大学减排', summary: 'A study of &#8220;campus&#8221; energy. Sign up here for more.', summary_zh: '一项校园能源研究', url: 'https://example.com/uni', pub: '2026-11-27T01:00:00Z', words: 8 },
      ],
    };
    const t4 = boot({ data: mixed });
    await sleep(200);
    click(t4.window, '[data-act="tab:study"]');
    click(t4.window, '[data-act="tab:news"]');
    await sleep(400);
    const cards = t4.doc.querySelectorAll('.ncard');
    assert(cards.length === 1, '只留下适合精读的一篇');
    assert(text(t4.doc).includes('Universities cut emissions'), '保留大学减排');
    assert(!text(t4.doc).includes('Black Friday') && !text(t4.doc).toLowerCase().includes('spoiler'), '购物和剧透被滤掉');
    click(t4.window, '.ncard');
    const detail = text(t4.doc);
    assert(detail.includes('campus') && !detail.includes('&#8220;') && !detail.includes('Sign up'), '摘要解码实体并去掉订阅尾巴');

    console.log('\nNEWS TEST PASS');
    process.exit(0);
  } catch (e) {
    console.error('\nFAIL:', e.message);
    process.exit(1);
  }
})();
