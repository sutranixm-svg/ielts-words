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
  },
});
const { window } = dom;
const doc = window.document;

function click(sel) {
  const el = doc.querySelector(sel);
  if (!el) throw new Error('missing element: ' + sel);
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}
const text = () => doc.getElementById('view').textContent.replace(/\s+/g, ' ').trim();
const assert = (cond, msg) => {
  if (!cond) throw new Error('ASSERT: ' + msg);
  console.log('ok  ' + msg);
};

setTimeout(() => {
  try {
    assert(text().includes('今日目标'), 'today screen renders');
    assert(doc.querySelectorAll('.tab').length === 5, 'five tabs');

    click('[data-act^="start"]');
    assert(doc.querySelector('.flash .word'), 'study card shows a word');
    const firstWord = doc.querySelector('.flash .word').textContent;
    assert(!doc.querySelector('.meaning'), 'meaning hidden before reveal');
    click('.flash');
    assert(doc.querySelector('.meaning'), 'tapping card reveals meaning');
    assert(doc.querySelectorAll('.grade').length === 3, 'three grade buttons');
    click('[data-act="grade:good"]');
    assert(doc.querySelector('.count').textContent.startsWith('2/'), 'advances to card 2');

    let guard = 0;
    while (!doc.querySelector('[data-act^="start"]') && guard++ < 100) {
      const reveal = doc.querySelector('[data-act="reveal"]');
      if (reveal) reveal.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      const g = doc.querySelector('[data-act="grade:good"]');
      if (g) g.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      else break;
    }
    assert(text().includes('本组认识率'), 'session summary shown');
    const st = window.__ielts.state();
    assert(Object.keys(st.words).length >= 10, 'progress persisted in memory');

    click('[data-act^="start"]');
    const cnt = doc.querySelector('.count') ? doc.querySelector('.count').textContent : '';
    assert(cnt.includes('/15'), '加练组开始（15 张）：' + cnt);

    click('[data-act="pause"]');
    click('[data-act="tab:quiz"]');
    assert(text().includes('测验'), 'quiz setup renders');
    click('[data-act="quiz:start:zh"]');
    assert(doc.querySelectorAll('.opt').length === 4, 'four options');
    click('[data-act="quiz:answer:0"]');
    assert(text().includes('下一题') || text().includes('看结果'), 'feedback + next');
    let q = 0;
    while (doc.querySelector('[data-act="quiz:next"]') && q++ < 15) {
      click('[data-act="quiz:next"]');
      const opt = doc.querySelector('[data-act="quiz:answer:0"]');
      if (opt) opt.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    }
    assert(text().includes('正确率'), 'quiz result renders');

    click('[data-act="tab:library"]');
    assert(text().includes('主题进度'), 'library renders');
    click('[data-act="open:settings"]');
    assert(text().includes('每天新词'), 'settings renders');
    click('[data-act="set:new:20"]');
    assert(window.__ielts.state().settings.dailyNew === 20, 'setting update saved');
    click('[data-act="ask-reset"]');
    assert(text().includes('确认重置'), 'reset confirm opens');
    click('[data-act="cancel"]');

    const saved = JSON.parse(window.localStorage.getItem('ielts.vocab.v2'));
    assert(saved && saved.schema === 2, 'progress stored as schema 2');
    assert(saved && saved.settings.dailyNew === 20, 'localStorage persisted');

    assert(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    console.log('\nALL PASS, words:', Object.keys(saved.words).length);
    window.close();
    process.exit(0);
  } catch (e) {
    console.error('\nFAIL:', e.message);
    console.error('errors:', errors);
    console.error(text().slice(0, 400));
    process.exit(1);
  }
}, 150);
