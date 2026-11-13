const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const { inlineHtml } = require('./inline.js');
let html = inlineHtml(root);

const errors = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://ielts.local/',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.scrollTo = () => {};
    window.addEventListener('error', (e) => errors.push(e.message));
    window.fetch = () => new Promise(() => {}); // 更新检查挂起，不干扰
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

setTimeout(() => {
  try {
    // 默认精编 720 + 雅思，不含托福
    assert(S().settings.decks.length === 7, '默认 7 个词库（精编 + 雅思）');
    assert(S().settings.decks.indexOf('toefl') < 0, '默认不选托福');
    assert(text().includes('7/8 个词库'), '今天页显示 7/8 个词库');
    assert(text().includes('5371 词'), '今天页显示在学词数 5371');
    const topicOfEarly = new Map(window.WORDS.map((w) => [w.w, w.t]));
    const firstNew = window.__ielts.buildQueue('new').queue[0];
    assert(topicOfEarly.get(firstNew.w) === 'education', '新词从精编教育按顺序开始：' + firstNew.w);

    // 进入学习范围
    click('[data-act="open:decks"]');
    assert(text().includes('学习范围'), '进入学习范围页');
    assert(doc.querySelectorAll('.deck').length === 8, '列出 8 个词库');

    // 取消雅思，只留精编
    click('[data-act="deck:ielts"]');
    assert(S().settings.decks.length === 6, '取消勾选后剩 6 个');
    assert(S().settings.decks.indexOf('ielts') < 0, 'ielts 已从选择中移除');
    const left = 5371 - 4651;
    const stat = window.__ielts.stats();
    assert(stat.total === left, '统计总数随选择变化：' + stat.total + ' / ' + left);

    // 学习队列只取选中词库
    const built = window.__ielts.buildQueue('new');
    const topicOf = new Map(window.WORDS.map((w) => [w.w, w.t]));
    assert(built.queue.length > 0, '仍有可学新词');
    assert(built.queue.every((q) => topicOf.get(q.w) !== 'ielts' && topicOf.get(q.w) !== 'toefl'), '队列里没有未选词库的词');

    // 全不选
    click('[data-act="deck-none"]');
    assert(S().settings.decks.length === 0, '全不选');
    assert(text().includes('已选 0 / 8'), '页面提示已选 0 个');
    assert(window.__ielts.buildQueue('new').queue.length === 0, '没有选中词库时不产生队列');

    // 全选恢复
    click('[data-act="deck-all"]');
    assert(S().settings.decks.length === 8, '全选恢复 8 个');

    // 词表浏览
    click('[data-act="back"]');
    click('[data-act="tab:library"]');
    click('[data-act="words:education"]');
    let txt = text();
    assert(txt.includes('共 120 词'), '精编教育词表 120 词');
    assert(doc.querySelectorAll('#wlist .wrow').length === 60, '首屏渲染 60 条（分页）');
    assert(doc.body.innerHTML.includes('加载更多'), '超出部分提供加载更多');
    click('[data-act="words-more"]');
    assert(doc.querySelectorAll('#wlist .wrow').length === 120, '加载更多后 120 条');

    // 打开大词表
    click('[data-act="back"]');
    click('[data-act="words:ielts"]');
    assert(text().includes('共 4651 词'), '雅思词表 4651 词');
    const first = doc.querySelector('#wlist .wrow b').textContent;
    assert(/^[a-z][a-z'-]*$/.test(first), '词表按字母序从 a 开始：' + first);

    // 搜索
    const input = doc.getElementById('wq');
    input.value = first.slice(0, 4);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    const hits = doc.querySelectorAll('#wlist .wrow').length;
    assert(hits >= 1 && hits <= 120, '前缀搜索收窄到 ' + hits + ' 条');
    assert(doc.getElementById('wlist').textContent.toLowerCase().includes(first.slice(0, 4)), '搜索结果命中前缀 ' + first.slice(0, 4));

    // 中文搜索
    input.value = '的';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert(doc.querySelectorAll('#wlist .wrow').length > 10, '支持中文释义搜索');

    // 空结果
    input.value = 'zzzzqqqq';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert(doc.getElementById('wlist').textContent.includes('没有匹配的词'), '无结果有提示');

    assert(errors.length === 0, '无运行时错误' + (errors.length ? ': ' + errors.join(' | ') : ''));
    console.log('\nDECK TEST PASS');
    window.close();
    process.exit(0);
  } catch (e) {
    console.error('\nFAIL:', e.message);
    console.error('errors:', errors);
    console.error(text().slice(0, 300));
    process.exit(1);
  }
}, 300);
