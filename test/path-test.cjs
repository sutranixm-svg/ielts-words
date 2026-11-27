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
const pad = (n) => String(n).padStart(2, '0');
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dstr(d); };

setTimeout(() => {
  try {
    const PATH = window.PATH;
    const api = window.__ielts;
    const S = () => api.state();
    const full = PATH.fullSchedule(PATH.familyCount());
    assert(PATH.familyCount() === 570, 'AWL 570 个词族');
    assert(PATH.DATA.awl.filter((f) => f.sub === 10).length === 30, 'Sublist 10 有 30 个词族');
    assert(PATH.DATA.awl.every((f) => f.rep), '每个词族都有可学习的词');
    assert(full.length === 23, '570 个词族分成 23 组');
    assert(full[0].count === 25 && full[0].reviews.length === 0 && full[0].selfCheck, '第 1 组 25 个词族，没有往日复习');
    assert(full[0].label.indexOf('Sublist 1') >= 0 && full[0].label.indexOf('1–25') >= 0, '第 1 组是 Sublist 1 的前 25 个：' + full[0].label);
    assert(full[2].count === 25, '第 3 组仍是 25 个');
    assert(full[2].label.indexOf('Sublist 1') >= 0 && full[2].label.indexOf('51–60') >= 0, '第 3 组含 Sublist 1 末段');
    assert(full[2].label.indexOf('Sublist 2') >= 0 && full[2].label.indexOf('1–15') >= 0, '第 3 组含 Sublist 2 开头');
    const day5 = full[4].reviews.map((r) => r.list + ':' + r.node).join(',');
    assert(day5 === '4:1,3:2,1:4', '第 5 组复习第 4/3/1 组的 1、2、4 天节点：' + day5);
    assert(full[7].reviews.some((r) => r.list === 1 && r.node === 7), '第 8 组包含第 1 组的第 7 天');
    assert(full[15].reviews.some((r) => r.list === 1 && r.node === 15), '第 16 组包含第 1 组的第 15 天');
    assert(full[20].label.indexOf('Sublist 9') >= 0 && full[20].label.indexOf('21–45') >= 0, '第 21 组落在 Sublist 9：' + full[20].label);
    assert(full[22].count === 20, '最后一组是剩下的 20 个词族');
    const core = PATH.fullSchedule(360);
    assert(core.length === 15 && core[14].count === 10, '默认学到 Sublist 6，最后一组 10 个词族');
    assert(PATH.priorityOf(1) === '优先' && PATH.priorityOf(5) === '接下来' && PATH.priorityOf(8) === '按目标选学', 'Sublist 优先级');

    assert(api.unlockedMax() === 1, '新用户只解锁第 1 阶段');
    S().settings.bandL = 8;
    S().settings.bandR = 7.5;
    assert(api.reportedBand() === 7.5, '目标分取听力和阅读里较低的');
    assert(PATH.stageForBand(api.reportedBand()) === 4, '7.5 对应第 4 阶段');
    assert(api.unlockedMax() === 1, '分数高也不能跳过阶段');
    click('[data-act="open:path"]');
    click('[data-act="stage:4"]');
    assert(S().settings.stage === 1, '点未解锁阶段不会切过去');
    assert(text().includes('538'), '第 3 阶段说明核心词表没有内置');
    assert(text().indexOf('刘洪波') < 0, '界面不出现版权书名');

    S().settings.stage = 2;
    S().settings.followPath = true;
    S().settings.studyDepth = 'understand';
    S().session = null;
    click('[data-act="tab:today"]');
    click('[data-act="start"]');
    click('[data-act="reveal"]');
    const senses = doc.querySelectorAll('.sense').length;
    assert(senses >= 2, '理解模式展示多条释义：' + senses);
    assert(text().includes('同族'), '学术词按词族展示已有成员');
    const shown = doc.querySelector('.flash .word').textContent.replace('🔊', '').trim();
    assert(shown === PATH.DATA.awl[0].rep, '第一张是 Sublist 1 的第一个词族：' + shown);
    click('[data-act="pause"]');

    const rep = PATH.DATA.awl[0].rep;
    S().session = null;
    S().words = {};
    S().words[rep] = {
      box: 2, due: '2099-01-01', seen: 1, right: 1, wrong: 0,
      first: '2020-01-01', last: addDays(-1), stability: 8, difficulty: 5,
      reps: 1, lapses: 0, state: 'review', wstep: 1, wdue: '2099-01-01',
    };
    S().awl = { started: { 1: addDays(-1) } };
    const queued = api.buildQueue('review');
    assert(queued.queue.some((item) => item.w === rep), '计划节点会把未到 FSRS 日期的词提出来');
    assert(S().words[rep].due === '2099-01-01' && S().words[rep].stability === 8, '提出来复习不会改写 FSRS 记录');
    click('[data-act="tab:study"]');
    click('[data-act="start:review"]');
    click('[data-act="reveal"]');
    click('[data-act="grade:good"]');
    assert(S().words[rep].stability !== 8, '评分后仍走 FSRS');
    assert(S().words[rep].due !== '2099-01-01', '评分后更新到期日');

    S().settings.stage = 1;
    S().settings.followPath = true;
    S().session = null;
    api.addCustom('listen', 'harbour', '', 'port');
    api.addCustom('review', 'quayside', '码头边', '');
    const added = api.buildQueue('new').queue.map((item) => item.w);
    assert(added.indexOf('harbour') >= 0 && added.indexOf('quayside') >= 0, '听力词和复盘生词进入今天的新词');
    assert(added.indexOf('harbour') < added.indexOf(window.PATH.DATA.gk[0]), '新添加的生词排在词表前面');
    const exported = JSON.parse(api.exportPayload());
    assert(exported.state.custom.listen.some((e) => e.w === 'harbour' && e.para === 'port'), '导出生词和改写');
    assert(exported.state.words.harbour && exported.state.words.harbour.seen >= 0, '生词的记忆记录一起导出');
    assert(exported.schema === 2, '导出仍是 v2');

    assert(errors.length === 0, '无运行时错误 ' + errors.join(' | '));
    console.log('\nPATH TEST PASS');
    window.close();
    process.exit(0);
  } catch (e) {
    console.error('\nFAIL:', e.message);
    console.error(text().slice(0, 500));
    console.error(errors);
    process.exit(1);
  }
}, 300);
