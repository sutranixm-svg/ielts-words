const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html0 = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
const words = fs.readFileSync(path.join(root, 'web/words.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'web/app.js'), 'utf8');

const ASSET = 'https://github.com/sutranixm-svg/ielts-words/releases/download/v9.9.9/ielts-vocab.apk';

function boot({ version = '1.2.0', tag = 'v9.9.9', withBridge = true } = {}) {
  const calls = [];
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
          // 国内镜像的版本清单
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
    assert(t.calls[0] === ASSET, '把镜像地址列表交给原生');
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
    t4.window.fetch = (url) => {
      const u = String(url);
      if (u.indexOf('version.json') >= 0) return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
      if (u.indexOf('api.github.com') >= 0) {
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
    assert(t4.window.__ielts.state().update && t4.window.__ielts.state().update.version === '9.9.9',
      '镜像失败时回落 GitHub API 仍能拿到版本');
    t4.window.close();

    console.log('\nUPDATE TEST PASS');
    process.exit(0);
  } catch (e) {
    console.error('\nFAIL:', e.message);
    process.exit(1);
  }
})();
