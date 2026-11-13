const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const { inlineHtml } = require('./inline.js');
let html = inlineHtml(root);

const rec = { started: 0, stopped: 0, playing: [] };
const errors = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://ielts.local/',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.scrollTo = () => {};
    window.fetch = () => new Promise(() => {});
    window.speechSynthesis = { cancel: () => {}, speak: () => {}, getVoices: () => [], addEventListener: () => {} };
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
    window.HTMLMediaElement.prototype.play = function () { rec.playing.push(this.src); return Promise.resolve(); };
    window.App = {
      version: () => '1.7.0',
      installUpdate: () => {},
      openUrl: () => {},
      platform: () => 'android',
      startRecord: () => { rec.started += 1; return true; },
      stopRecord: () => { rec.stopped += 1; return 'rec.m4a'; },
      recordUrl: () => 'content://com.dsh.ielts.apk/rec.m4a',
    };
    window.Audio = function (src) { this.src = src; this.play = function () { rec.playing.push(src); return Promise.resolve(); }; };
    window.addEventListener('error', (e) => errors.push(e.message));
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

function essay(n) {
  const pool = ['many', 'people', 'argue', 'that', 'university', 'education', 'should', 'be', 'free', 'for',
    'everyone', 'because', 'it', 'benefits', 'society', 'as', 'a', 'whole', 'however', 'the', 'cost',
    'must', 'also', 'be', 'considered', 'by', 'governments', 'students', 'gain', 'skills', 'and',
    'contribute', 'to', 'economic', 'growth', 'in', 'the', 'long', 'term'];
  const out = [];
  let count = 0;
  let i = 0;
  while (count < n) {
    const len = 8 + (i % 6);
    const s = [];
    for (let j = 0; j < len; j += 1) s.push(pool[(i * 7 + j * 3) % pool.length]);
    s[0] = s[0][0].toUpperCase() + s[0].slice(1);
    out.push(s.join(' ') + '.');
    count += len;
    i += 1;
    if (i % 4 === 0) out.push('');
  }
  return out.join(' ');
}

setTimeout(() => {
  try {
    /* ---------- 阅读练习 ---------- */
    click('[data-act="tab:study"]');
    click('[data-act="open:reading"]');
    assert(text().includes('阅读练习'), '进入阅读练习');
    const cards = doc.querySelectorAll('.cue');
    assert(cards.length === 2, '两篇原创文章');
    assert(text().includes('原创'), '说明了不是真题');
    click('[data-act="read:0"]');
    assert(doc.querySelectorAll('.passage p').length >= 4, '文章按段落渲染');
    assert(doc.querySelectorAll('.q').length === 7, '第 1 篇 7 道题');

    // 答对一题
    const q0 = doc.querySelectorAll('.q')[0];
    const trueBtn = Array.from(q0.querySelectorAll('.q-opt')).find((b) => b.textContent.trim() === 'TRUE');
    trueBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    let q0now = doc.querySelectorAll('.q')[0];
    assert(q0now.querySelector('.q-why.good'), '答对显示绿色解析');
    assert(q0now.textContent.includes('正确答案：TRUE'), '解析里有正确答案');

    // 答错一题（第 2 题答案 FALSE，选 TRUE）
    const q1 = doc.querySelectorAll('.q')[1];
    Array.from(q1.querySelectorAll('.q-opt')).find((b) => b.textContent.trim() === 'TRUE')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    q0now = doc.querySelectorAll('.q')[1];
    assert(q0now.querySelector('.q-why.bad'), '答错显示红色解析并给出正确答案');
    assert(q0now.textContent.includes('FALSE'), '错题也给出正确答案');

    /* ---------- 写作自查 ---------- */
    click('[data-act="back"]');
    click('[data-act="back"]');
    click('[data-act="open:writing"]');
    click('[data-act="wtop:0"]');
    const ta = doc.getElementById('wdraft');
    ta.value = essay(60);
    ta.dispatchEvent(new window.Event('input', { bubbles: true }));
    click('[data-act="wcheck"]');
    let rep = text();
    assert(rep.includes('自查结果'), '出报告');
    assert(rep.includes('词数 6') || /词数\s*\d+/.test(rep), '报告含词数');
    assert(rep.includes('还差'), '词数不足时提示还差多少');
    assert(doc.querySelectorAll('.rep-row.bad').length >= 1, '有 bad 级问题');

    const goodEssay = `Many people argue that university education should be free for everyone, because it benefits society as a whole. However, the cost must also be considered by governments that fund it.

Firstly, free tuition removes a significant barrier for students from low-income families. When young people can study without taking on large debts, they are more likely to choose courses based on interest rather than on future earnings. Consequently, society gains graduates who are both motivated and well matched to the work they do.

Moreover, a better educated workforce attracts investment. Countries with highly skilled populations tend to develop faster, and this growth generates tax revenue that can be used to support public services. In other words, the money spent on tuition may eventually return to the state and improve the lives of people who never attended university at all.

On the other hand, critics point out that free university places are expensive to maintain. If the government pays for everything, it may have less to spend on primary schools or hospitals, which arguably affect a much larger number of people. Therefore, some countries have chosen a mixed system, where students pay part of the fee and receive a loan that is repaid from future income once they are employed.

In conclusion, while universal free education is attractive in principle, the practical solution depends on a country's finances and on how fairly it distributes opportunity. Nevertheless, no student should be prevented from studying simply because of the family they were born into, and that principle should guide the design of any funding system.`;
    // 合格长度（重新渲染后要重新取 textarea，旧节点已脱离文档）
    const ta2 = doc.getElementById('wdraft');
    ta2.value = goodEssay;
    ta2.dispatchEvent(new window.Event('input', { bubbles: true }));
    click('[data-act="wcheck"]');
    rep = text();
    const passRows = doc.querySelectorAll('.rep-row.pass').length;
    assert(passRows >= 2, '结构完整的文章至少两项通过（' + passRows + ' 项）');
    assert(/词数\s*\d{3}/.test(rep), '词数统计正确');

    /* ---------- 口语录音 ---------- */
    click('[data-act="back"]');
    click('[data-act="back"]');
    click('[data-act="open:speaking"]');
    click('[data-act="cue:3"]');
    assert(Boolean(doc.querySelector('[data-act="rec-start"]')), '有录音按钮');
    assert(doc.querySelector('[data-act="rec-play"]').disabled, '没录音时回放禁用');
    click('[data-act="rec-start"]');
    assert(rec.started === 1, '调用了原生开始录音');
    assert(Boolean(doc.querySelector('[data-act="rec-stop"]')), '进入录音中状态');
    click('[data-act="rec-stop"]');
    assert(rec.stopped === 1, '调用了原生停止录音');
    const play = doc.querySelector('[data-act="rec-play"]');
    assert(!play.disabled, '录完后回放可用');
    click('[data-act="rec-play"]');
    assert(rec.playing.length === 1 && rec.playing[0].indexOf('content://') === 0, '回放用了 content:// 地址');

    assert(errors.length === 0, '无运行时错误' + (errors.length ? ': ' + errors.join(' | ') : ''));
    console.log('\nEXTRA TEST PASS');
    window.close();
    process.exit(0);
  } catch (e) {
    console.error('\nFAIL:', e.message);
    console.error('errors:', errors.slice(0, 3));
    process.exit(1);
  }
}, 300);
