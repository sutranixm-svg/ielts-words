const path = require('path');
const { JSDOM } = require('jsdom');
const { inlineHtml } = require('./inline.js');

const root = path.resolve(__dirname, '..');
const html = inlineHtml(root);
const errors = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://ielts.local/',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.scrollTo = () => {};
    window.fetch = () => new Promise(() => {});
    window.App = {
      version: () => '1.9.4',
      platform: () => 'android',
      playAsset: () => true,
      playUrl: () => {},
      speakText: () => {},
      hasTts: () => true,
    };
    window.addEventListener('error', (e) => errors.push(e.message));
  },
});

const { window } = dom;
const doc = window.document;
const click = (sel) => {
  const el = doc.querySelector(sel);
  if (!el) throw new Error('missing ' + sel);
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
};
const text = () => doc.getElementById('view').textContent.replace(/\s+/g, ' ');
const assert = (c, m) => {
  if (!c) throw new Error(m);
  console.log('ok  ' + m);
};

setTimeout(() => {
  try {
    const S = () => window.__ielts.state();
    click('[data-act="tab:quiz"]');
    click('[data-act="quiz:start:type-en"]');
    const item = S().quiz.items[0];
    assert(item.typed && item.kind === 'type-en', '中译英是输入题');
    const input = doc.getElementById('typed');
    input.value = '  ' + String(item.expect).toUpperCase() + '  ';
    click('[data-act="quiz:typed"]');
    assert(S().quiz.items[0].correct === true, '大小写和空格不算错');
    assert((S().days[Object.keys(S().days)[0]] || {}).quiz >= 1, '输入题计入今天的学习量');

    click('[data-act="quiz:next"]');
    const wrong = S().quiz.items[S().quiz.pos];
    doc.getElementById('typed').value = 'not-the-word';
    click('[data-act="quiz:typed"]');
    assert(S().quiz.items[S().quiz.pos].correct === false, '完全不同的拼写判错');
    assert(text().includes('差异'), '错了会给差异');
    assert(text().includes(wrong.expect), '错了会给正确答案');

    S().quiz = null;
    click('[data-act="pause"]');
    click('[data-act="tab:quiz"]');
    click('[data-act="quiz:start:cloze"]');
    assert(S().quiz.items[0].kind === 'cloze' && S().quiz.items[0].prompt.includes('______'), '完形是挖空的例句');
    doc.getElementById('typed').value = S().quiz.items[0].expect;
    doc.getElementById('typed').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert(S().quiz.items[0].correct === true, '回车提交填空');

    const badIpa = window.WORDS.filter((w) => (w.ipa || '').includes('\\'));
    assert(badIpa.length === 0, '词库音标不含反斜杠');
    assert(window.WORDS.find((w) => w.w === 'conversely').ipa === '/ˈkɔnvɜːsli/', 'conversely 的 ɜ 已还原');
    assert(window.WORDS.find((w) => w.w === 'drought').ipa === '/dɹʌʊt/', '方括号音标改成斜杠');
    const abate = window.WORDS.find((w) => w.w === 'abate').zh.split('；');
    assert(abate.length === new Set(abate).size, '重复释义已去掉');
    assert(window.LEXICON_EXTRA['co-operation'] && window.LEXICON_EXTRA['co-operation'].ipa, 'co-operation 借用了 cooperation 的音标');

    click('[data-act="pause"]');
    S().quiz = null;
    click('[data-act="tab:quiz"]');
    click('[data-act="quiz:start:spell"]');
    S().quiz.items.forEach((item) => {
      if (item.kind === 'spell') assert(item.options.length >= 4, '拼写题至少 4 个选项：' + item.w);
      else assert(item.kind === 'zh', '选项不够时改问词义：' + item.w);
    });
    click('[data-act="pause"]');
    S().quiz = null;
    S().session = {
      day: '2026-01-01', queue: [{ w: 'not-a-real-word', kind: 'new' }], pos: 0, revealed: false, done: false,
      results: { good: 0, hard: 0, again: 0, easy: 0 }, newCount: 1, reviewCount: 0, requeued: {},
    };
    click('[data-act="tab:study"]');
    assert(S().session.done === true, '词库里没有的卡片会跳过');
    assert(text().indexOf('undefined') < 0, '缺词不会把学习页打崩');
    S().session = null;

    click('[data-act="pause"]');
    S().settings.dailyNew = 1;
    S().settings.dailyGoal = 20;
    S().session = null;
    click('[data-act="start"]');
    const word = doc.querySelector('.flash .word').textContent.replace('🔊', '').trim();
    click('[data-act="reveal"]');
    click('[data-act="grade:again"]');
    click('[data-act="reveal"]');
    click('[data-act="grade:again"]');
    click('[data-act="pause"]');
    S().session = null;
    click('[data-act="tab:study"]');
    click('[data-act="open:weak"]');
    assert(text().includes('本周薄弱'), '打开薄弱报告');
    assert(text().includes(word), '报告里能看到这个词：' + word);
    assert(text().includes('再认'), '错误归到再认');
    const rec = S().words[word];
    assert(rec && rec.weak === true && rec.due === Object.keys(S().days).sort().pop(), '同一词再认错两次会自动排进今天');
    assert(errors.length === 0, '无运行时错误 ' + errors.join(' | '));
    console.log('\nLEARN TEST PASS');
    window.close();
    process.exit(0);
  } catch (e) {
    console.error('\nFAIL:', e.message);
    console.error(text().slice(0, 400));
    console.error(errors);
    process.exit(1);
  }
}, 300);
