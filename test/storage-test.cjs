const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html0 = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
const words = fs.readFileSync(path.join(root, 'web/words.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'web/app.js'), 'utf8');

function boot(before) {
  const errors = [];
  const html = html0
    .replace('<script src="words.js"></script>', '<script>' + words + '</script>')
    .replace('<script src="app.js"></script>', '<script>' + app + '</script>');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://ielts.local/',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.fetch = () => new Promise(() => {});
      window.addEventListener('error', (e) => errors.push(e.message));
      if (before) before(window);
    },
  });
  return { window: dom.window, errors };
}

const assert = (c, m) => {
  if (!c) throw new Error('ASSERT: ' + m);
  console.log('ok  ' + m);
};

setTimeout(() => {
  try {
    const v1 = {
      v: 1,
      words: {
        academic: {
          box: 3,
          due: '2026-12-01',
          seen: 4,
          right: 3,
          wrong: 1,
          wstep: 2,
          wdue: '2026-11-01',
        },
      },
      days: { '2026-11-01': { new: 2, review: 1, right: 2, wrong: 0 } },
      settings: { dailyNew: 12, decks: ['education', 'ielts'] },
      seenUpdate: '1.2.0',
    };
    const migrated = boot((window) => {
      window.localStorage.setItem('ielts.vocab.v1', JSON.stringify(v1));
    });
    const S = migrated.window.__ielts.state();
    assert(S.schema === 2, '从 v1 迁到 schema 2');
    assert(S.words.academic.seen === 4, '单词进度还在');
    assert(S.words.academic.wdue === '2026-11-01', '旧的错词到期日没丢');
    assert(S.words.academic.box === 3, '旧的 box 还在');
    assert(S.settings.dailyNew === 12, '每天新词设置还在');
    assert(S.settings.decks.length === 2, '词库选择还在');
    assert(S.seenUpdate === '1.2.0', '稍后再说的版本号还在');
    const stored = JSON.parse(migrated.window.localStorage.getItem('ielts.vocab.v2'));
    assert(stored && stored.schema === 2 && stored.words.academic.w === undefined && stored.words.academic.seen === 4, 'v2 已写入');
    assert(migrated.window.localStorage.getItem('ielts.vocab.v1'), '旧 key 先留着，避免迁移失败丢数据');
    assert(migrated.errors.length === 0, '迁移过程没有运行时错误');
    migrated.window.close();

    const broken = boot((window) => {
      window.localStorage.setItem('ielts.vocab.v2', '{');
      window.localStorage.setItem('ielts.vocab.v1', JSON.stringify({
        words: { zebra: { seen: 2, box: 1, due: '2026-12-02' } },
        settings: { dailyNew: 8 },
      }));
    });
    assert(broken.window.__ielts.state().words.zebra.seen === 2, 'v2 损坏时退回 v1');
    assert(broken.window.__ielts.state().settings.dailyNew === 8, '退回 v1 后设置还在');
    assert(broken.window.__ielts.saveError().length > 0, '读坏掉的进度会把错误留在界面状态里');
    broken.window.close();

    const fresh = boot();
    const api = fresh.window.__ielts;
    const payload = JSON.parse(api.exportPayload());
    assert(payload.app === 'ielts-words' && payload.schema === 2 && payload.state && !payload.state.ui, '导出 JSON 带 schema 且不含界面状态');
    api.importState({
      schema: 2,
      state: {
        words: { imported: { seen: 1, box: 1, due: '2026-12-03' } },
        settings: { dailyNew: 40, decks: ['ielts'] },
        seenUpdate: '9.9.9',
      },
    });
    assert(api.state().words.imported.seen === 1, '导入后能读到单词');
    assert(api.state().settings.dailyNew === 40, '导入后设置生效');
    assert(api.state().seenUpdate === '9.9.9', '导入保留稍后再说');

    const backups = api.backups();
    assert(backups.length >= 1, '启动时写了每日备份（' + backups.length + '）');
    const day = backups[0].day;
    api.state().settings.dailyNew = 7;
    api.save();
    api.restoreBackup(day);
    assert(api.state().settings.dailyNew !== 7, '恢复备份后回到备份里的设置（' + api.state().settings.dailyNew + '）');

    const proto = Object.getPrototypeOf(fresh.window.localStorage);
    const origSet = proto.setItem;
    Object.defineProperty(proto, 'setItem', {
      configurable: true,
      writable: true,
      value: function () { throw new Error('quota'); },
    });
    const ok = api.save();
    assert(ok === false, '写入失败时 save 返回 false');
    assert(api.saveError().indexOf('quota') >= 0, '保存错误会暴露出来');
    assert(fresh.window.document.getElementById('toast').textContent.indexOf('保存失败') >= 0, '保存失败有提示');
    Object.defineProperty(proto, 'setItem', { configurable: true, writable: true, value: origSet });

    assert(fresh.errors.length === 0, '无运行时错误' + (fresh.errors.length ? ': ' + fresh.errors.join(' | ') : ''));
    console.log('\nSTORAGE TEST PASS');
    fresh.window.close();
    process.exit(0);
  } catch (e) {
    console.error('\nFAIL:', e.message);
    process.exit(1);
  }
}, 200);
