const fs = require('fs');
const path = require('path');

function inlineHtml(root) {
  const html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
  return html.replace(/<script src="([^"]+)"><\/script>/g, (full, src) => {
    if (/^https?:/i.test(src)) return full;
    return '<script>\n' + fs.readFileSync(path.join(root, 'web', src), 'utf8') + '\n</script>';
  });
}

module.exports = { inlineHtml };
