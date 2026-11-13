const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const { inlineHtml } = require('./inline.js');

const ASSET = 'https://github.com/sutranixm-svg/ielts-words/releases/download/v9.9.9/ielts-vocab.apk';

function boot({ version = '1.2.0', tag = 'v9.9.9', withBridge = true } = {}) {
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
      if (withBridge) {
        window.App = {
          version: () => version,
          installUpdate: (url) => calls.push(url),
          platform: () => 'android',
        };
      }
      window.fetch = (url) => {
        const u = String(url);
        if (u.indexOf('version.json') >= 0) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ version: tag.replace(/^v/, ''), urls: [ASSET], size: 745472 }),
          });
        }
        if (u.indexOf('api.github.com') >= 0) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                tag_name: tag,
                assets: [{ name: 'ielts-vocab.apk', size: 745472, browser_download_url: ASSET }],
              }),
          });
        }
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
      };
    },
  });
  return { dom, window: dom.window, doc: dom.window.document, calls, errors };
}

const text = (w) => w.document.getElementById('view').textContent.replace(/\s+/g, ' ').trim();
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
    // 1) 新版本可用
    let t = boot();
    await sleep(1900);
    assert(text(t.window).includes('有新版本可更新'), '检测到新版本后显示提示条');
    assert(text(t.window).includes('v9.9.9'), '提示条显示目标版本号');
    assert(text(t.window).includes('9.9 MB') || text(t.window).includes('0.7 MB'), '提示条显示包大小');

    // 2) 一键更新调用原生
    click(t.window, '[data-act="update"]');
    assert(t.calls.length === 1, '点击一键更新调用原生接口');
    assert(t.calls[0].indexOf('ielts-vocab-9.9.9.apk') > 0, '按版本号拼出镜像地址：' + t.calls[0].split('\n')[0]);
    assert(t.calls[0].split('\n').length >= 3, '交给原生的是多个镜像地址');
    assert(text(t.window).includes('下载中'), '进入下载态');

    // 3) 进度回传
    t.window.__updateStatus('progress:40');
    assert(text(t.window).includes('40%'), '进度百分比回传并渲染');

    // 4) 安装态
    t.window.__updateStatus('installing');
    assert(text(t.window).includes('安装中'), '安装态渲染');

    // 5) 失败态
    t.window.__updateStatus('error:HTTP 404');
    assert(text(t.window).includes('更新失败'), '失败原因渲染到提示条');

    // 6) 稍后再说
    t.window.__updateStatus('');
    click(t.window, '[data-act="update-later"]');
    assert(!text(t.window).includes('有新版本可更新'), '点×后提示条消失');
    t.window.document.querySelector('[data-act="tab:today"]');
    click(t.window, '[data-act="tab:today"]');
    assert(!text(t.window).includes('有新版本可更新'), '重新渲染后仍不打扰');
    assert(t.errors.length === 0, '无运行时错误');
    t.window.close();

    // 7) 已是最新
    const t2 = boot({ version: '9.9.9' });
    await sleep(1900);
    assert(!text(t2.window).includes('有新版本可更新'), '版本相同时不显示提示');
    t2.window.close();

    // 8) 词库总量与设置页信息
    const t3 = boot({ tag: 'v1.2.0', version: '1.2.0' });
    await sleep(200);
    click(t3.window, '[data-act="tab:library"]');
    const lib = text(t3.window);
    assert(/9[0-9]{3}/.test(lib), '词库页显示真实总词数（' + (lib.match(/\d{3,5}/) || [])[0] + '）');
    click(t3.window, '[data-act="open:settings"]');
    const set = text(t3.window);
    assert(set.includes('9277 词'), '设置页显示 9277 词');
    assert(set.includes('8 个主题'), '设置页显示 8 个主题');
    assert(set.includes('v1.2.0'), '设置页显示当前版本');
    t3.window.close();

    // 镜像全挂 → 回落 GitHub API
    const t4 = boot({ version: '1.0.0', tag: 'v9.9.9' });
    let apiCalls = 0;
    t4.window.fetch = (url) => {
      const u = String(url);
      if (u.indexOf('version.json') >= 0) return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
      if (u.indexOf('api.github.com') >= 0) {
        apiCalls += 1;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({
          tag_name: 'v9.9.9',
          assets: [{ name: 'ielts-vocab.apk', size: 745472, browser_download_url: ASSET }],
        }) });
      }
      return new Promise(() => {});
    };
    click(t4.window, '[data-act="tab:library"]');
    click(t4.window, '[data-act="open:settings"]');
    click(t4.window, '[data-act="check-update"]');
    await sleep(500);
    assert(apiCalls >= 1, '版本号走 GitHub API');
    assert(t4.window.__ielts.state().update && t4.window.__ielts.state().update.version === '9.9.9',
      'API 返回版本后正确解析');
    t4.window.close();

    // 9) API 更旧、dist 更新：取更高的版本，并按文件名选安装包
    const pure = boot({ version: '1.0.0', tag: 'v1.0.0' });
    const picked = pure.window.__ielts.chooseUpdate(
      {
        tag_name: 'v1.0.0',
        assets: [
          { name: 'notes.txt', browser_download_url: 'https://example.com/notes.txt', size: 10 },
          { name: 'ielts-vocab-1.0.0.apk', browser_download_url: 'https://github.com/sutranixm-svg/ielts-words/releases/download/v1.0.0/ielts-vocab-1.0.0.apk', size: 11 },
        ],
      },
      {
        version: '3.2.0',
        versionCode: 20,
        size: 222,
        sha256: 'abc123',
        urls: ['http://evil.example/ielts-vocab-3.2.0.apk', 'https://cdn.example/ielts-vocab-3.2.0.apk'],
      }
    );
    assert(picked.version === '3.2.0', 'dist 版本更高时采用 dist（' + picked.version + '）');
    assert(picked.urls.every((u) => u.indexOf('https://') === 0), '候选地址只有 https');
    assert(picked.urls.some((u) => u.indexOf('ielts-vocab-3.2.0.apk') > 0), '下载地址带版本文件名');
    assert(!picked.urls.some((u) => u.indexOf('http://') === 0), '丢掉 http 地址');

    const named = pure.window.__ielts.pickAsset([
      { name: 'wrong.zip', browser_download_url: 'https://example.com/wrong.zip' },
      { name: 'ielts-vocab-2.0.0.apk', browser_download_url: 'https://example.com/ielts-vocab-2.0.0.apk', digest: 'sha256:deadbeef' },
    ], '2.0.0');
    assert(named && named.name === 'ielts-vocab-2.0.0.apk', '按文件名选择资源，不用 assets[0]');
    assert(pure.window.__ielts.pickAsset([{ name: 'ielts-vocab.apk', browser_download_url: 'https://example.com/ielts-vocab.apk' }], '2.0.0') === null, '名字对不上时不回退到第一个资源');

    const abc = pure.window.__ielts.sha256('abc');
    assert(abc === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256("abc")');
    assert(pure.window.__ielts.acceptHash('abc', abc) === true, '哈希一致时接受');
    assert(pure.window.__ielts.acceptHash('abc', '00') === false, '哈希不一致时拒绝');
    assert(pure.window.__ielts.acceptHash('abc', '') === true, '没有摘要时不因哈希失败');
    pure.window.close();

    // 10) 超时：两个源都不返回
    const t5 = boot({ version: '1.0.0', tag: 'v9.9.9' });
    t5.window.__ielts.setFetchMs(80);
    t5.window.fetch = (url, opts) => new Promise((resolve, reject) => {
      const sig = opts && opts.signal;
      if (sig) sig.addEventListener('abort', () => reject(new Error('aborted')));
    });
    click(t5.window, '[data-act="tab:library"]');
    click(t5.window, '[data-act="open:settings"]');
    click(t5.window, '[data-act="check-update"]');
    await sleep(500);
    assert(t5.window.document.getElementById('toast').textContent.indexOf('检查更新失败') >= 0, '超时后提示检查失败');
    assert(!t5.window.__ielts.state().update, '超时不会写成有更新');
    t5.window.close();

    // 11) 稍后再说之后，同版本再检查仍然不打扰
    const t6 = boot({ version: '1.0.0', tag: 'v9.9.9' });
    await sleep(1900);
    click(t6.window, '[data-act="update-later"]');
    click(t6.window, '[data-act="tab:library"]');
    click(t6.window, '[data-act="open:settings"]');
    click(t6.window, '[data-act="check-update"]');
    await sleep(400);
    click(t6.window, '[data-act="tab:today"]');
    assert(!text(t6.window).includes('有新版本可更新'), '稍后再说会记住，同版本不再弹出');
    assert(t6.window.__ielts.state().seenUpdate === '9.9.9', 'seenUpdate 保持为 9.9.9');
    t6.window.close();

    console.log('\nUPDATE TEST PASS');
    process.exit(0);
  } catch (e) {
    console.error('\nFAIL:', e.message);
    process.exit(1);
  }
})();
