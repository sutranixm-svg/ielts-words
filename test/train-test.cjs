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

const spoken = [];
const errors = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://ielts.local/',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.scrollTo = () => {};
    window.fetch = () => new Promise(() => {});
    window.App = { version: () => '1.6.0', installUpdate: () => {}, openUrl: () => {}, platform: () => 'android' };
    window.speechSynthesis = {
      cancel: () => {},
      speak: (u) => spoken.push(u.text),
      getVoices: () => [{ lang: 'en-US', name: 'Test' }],
      addEventListener: () => {},
    };
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
    window.__played = [];
    window.Audio = function () {
      const self = this;
      this.src = '';
      this.play = function () { window.__played.push(self.src); return Promise.resolve(); };
      this.pause = function () {};
    };
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

setTimeout(() => {
  try {
    /* ---------- 学习页四项训练 ---------- */
    click('[data-act="tab:study"]');
    assert(text().includes('四项训练'), '学习页出现四项训练');
    assert(doc.querySelectorAll('.train').length === 4, '四个训练入口');

    /* ---------- 发音 ---------- */
    click('[data-act="tab:today"]');
    click('[data-act^="start"]');
    assert(Boolean(doc.querySelector('.flash .say')), '单词卡有发音按钮');
    // 内置音频词：直接构造一个 say 动作，走的是委托监听器
    doc.body.insertAdjacentHTML('beforeend', '<button id="tsay" data-act="say:academic">t</button>');
    doc.getElementById('tsay').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert(window.__played[0] === 'audio/academic.mp3', '有真人录音时优先播本地文件：' + window.__played[0]);
    // 没有内置音频的词：退回系统 TTS
    doc.body.insertAdjacentHTML('beforeend', '<button id="tsay2" data-act="say:zzzzz">t</button>');
    doc.getElementById('tsay2').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert(spoken.length === 1 && spoken[0] === 'zzzzz', '没有录音时退回语音合成：' + spoken[0]);
    click('[data-act="pause"]');
    S().session = null;

    /* ---------- 口语 ---------- */
    click('[data-act="tab:study"]');
    click('[data-act="open:speaking"]');
    assert(doc.querySelectorAll('.cue').length === 18, '口语有 18 张话题卡');
    click('[data-act="cue:0"]');
    assert(text().includes('YOU SHOULD SAY'), '话题卡显示提示点');
    assert(doc.querySelectorAll('.cue-points li').length === 4, '四个提示点');
    click('[data-act="cue-prep:0"]');
    const t1 = doc.getElementById('speakTimer').textContent;
    assert(/准备\s*1:00|准备\s*0:59/.test(t1), '准备计时启动：' + t1);
    click('[data-act="cue-talk:0"]');
    const t2 = doc.getElementById('speakTimer').textContent;
    assert(/作答\s*2:00|作答\s*1:59/.test(t2), '作答计时启动：' + t2);

    /* ---------- 写作 ---------- */
    click('[data-act="back"]');
    click('[data-act="back"]');
    click('[data-act="open:writing"]');
    assert(doc.querySelectorAll('.cue').length === 10, '写作有 10 个话题');
    assert(doc.querySelectorAll('.phr').length >= 8, '有高频句型');
    click('[data-act="wtop:0"]');
    const ta = doc.getElementById('wdraft');
    assert(Boolean(ta), '有草稿框');
    ta.value = 'My essay draft about free education.';
    ta.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert(S().writing['0'].includes('essay draft'), '草稿写入状态');
    click('[data-act="back"]');
    click('[data-act="wtop:0"]');
    assert(doc.getElementById('wdraft').value.includes('essay draft'), '返回后草稿还在');

    /* ---------- 阅读 ---------- */
    click('[data-act="back"]');
    click('[data-act="back"]');
    click('[data-act="open:reading"]');
    assert(doc.querySelectorAll('.tip').length === 6, '阅读技巧 6 条');

    /* ---------- 同义替换 ---------- */
    click('[data-act="back"]');
    click('[data-act="open:syn"]');
    assert(text().includes('同义替换'), '进入同义替换');
    click('[data-act="syn-start"]');
    const q = S().quiz;
    assert(q.kind === 'syn' && q.items.length === 10, '同义替换出 10 题');
    assert(q.items[0].options.length === 4, '每题 4 个选项');
    // 连答 10 题全对
    for (let i = 0; i < 10; i += 1) {
      const ans = S().quiz.items[S().quiz.pos].answer;
      click(`[data-act="quiz:answer:${ans}"]`);
      click('[data-act="quiz:next"]');
    }
    assert(S().quiz.score === 10, '同义替换全对计分 10');
    assert(text().includes('正确率 100%'), '结果页显示正确率');

    /* ---------- 模考 + Band ---------- */
    click('[data-act="quiz:again"]');
    click('[data-act="tab:quiz"]');
    assert(text().includes('模拟考'), '测验页有模拟考入口');
    click('[data-act="mock-start"]');
    assert(S().quiz.mock === true && S().quiz.items.length === 20, '模拟考 20 题');
    const timer = doc.getElementById('mockTimer');
    assert(Boolean(timer) && /^\d+:\d\d$/.test(timer.textContent), '模考计时器显示：' + timer.textContent);
    assert(S().quiz.items.some((x) => x.kind === 'listen'), '模考包含听音题');
    for (let i = 0; i < 20; i += 1) {
      const cur = S().quiz.items[S().quiz.pos];
      click(`[data-act="quiz:answer:${cur.answer}"]`);
      click('[data-act="quiz:next"]');
    }
    assert(text().includes('Band'), '模考结果显示 Band 粗估');

    /* ---------- 考试倒计时 ---------- */
    click('[data-act="tab:library"]');
    click('[data-act="open:settings"]');
    const d = new Date();
    d.setDate(d.getDate() + 30);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dateInput = doc.getElementById('examDate');
    assert(Boolean(dateInput), '设置页有考试日期输入');
    dateInput.value = iso;
    dateInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert(S().settings.examDate === iso, '考试日期已保存');
    click('[data-act="back"]');
    click('[data-act="tab:today"]');
    assert(text().includes('距离考试'), '首页显示倒计时');
    assert(/30 天/.test(text()), '倒计时天数正确（30 天）');
    assert(text().includes('每天'), '给出每天任务量建议');
    const before = S().settings.dailyNew;
    click('[data-act="apply-plan"]');
    assert(S().settings.dailyNew !== undefined, '可以一键应用计划（' + before + ' → ' + S().settings.dailyNew + '）');

    assert(errors.length === 0, '无运行时错误' + (errors.length ? ': ' + errors.join(' | ') : ''));
    console.log('\nTRAIN TEST PASS');
    window.close();
    process.exit(0);
  } catch (e) {
    console.error('\nFAIL:', e.message);
    console.error('errors:', errors.slice(0, 3));
    process.exit(1);
  }
}, 300);
