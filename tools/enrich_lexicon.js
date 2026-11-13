#!/usr/bin/env node
/**
 * 从现有词条补能确定的音标、搭配和易混词。
 * 不编造例句或释义。补不上的写进 CONTENT_GAPS.md。
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'web/words.js'), 'utf8');
const WORDS = JSON.parse(src.slice(src.indexOf('window.WORDS=') + 'window.WORDS='.length).replace(/;+\s*$/, ''));
const by = new Map(WORDS.map((w) => [w.w.toLowerCase(), w]));

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'that', 'this', 'with', 'as', 'at', 'by', 'from', 'it', 'its', 'their', 'his', 'her', 'they', 'we', 'you', 'not', 'but', 'if', 'so']);

const KNOWN_PAIRS = [
  ['affect', 'effect'], ['accept', 'except'], ['adapt', 'adopt'], ['access', 'assess'],
  ['compliment', 'complement'], ['principal', 'principle'], ['stationary', 'stationery'],
  ['economic', 'economical'], ['historic', 'historical'], ['sensible', 'sensitive'],
  ['continuous', 'continual'], ['imply', 'infer'], ['rise', 'raise'], ['borrow', 'lend'],
  ['invent', 'discover'], ['say', 'tell'], ['desert', 'dessert'], ['advice', 'advise'],
  ['practice', 'practise'], ['licence', 'license'], ['ensure', 'insure'],
  ['eminent', 'imminent'], ['elicit', 'illicit'], ['discreet', 'discrete'],
  ['council', 'counsel'], ['coarse', 'course'], ['bare', 'bear'], ['brake', 'break'],
  ['quiet', 'quite'], ['wander', 'wonder'], ['adverse', 'averse'], ['precede', 'proceed'],
  ['conscious', 'conscience'], ['industrial', 'industrious'], ['economic', 'economical'],
];

function pluralLemma(word) {
  const x = word.toLowerCase();
  if (/\s|-/.test(x)) return null;
  if (x.endsWith('ies')) {
    const y = x.slice(0, -3) + 'y';
    if (by.has(y)) return y;
  }
  if (x.endsWith('s') && !x.endsWith('ss')) {
    const one = x.slice(0, -1);
    if (by.has(one)) return one;
  }
  if (x.endsWith('es')) {
    const base = x.slice(0, -2);
    if (by.has(base)) return base;
  }
  return null;
}

function pluralIpa(lemmaIpa) {
  const body = String(lemmaIpa || '').replace(/^\/|\/$/g, '');
  if (!body || body.includes('\\')) return '';
  const sibilant = /(s|z|ʃ|ʒ|tʃ|dʒ)$/;
  const voiceless = /(p|t|k|f|θ)$/;
  let ending = 'z';
  if (sibilant.test(body)) ending = 'ɪz';
  else if (voiceless.test(body)) ending = 's';
  return '/' + body + ending + '/';
}

function spellingVariants(word) {
  const x = word.toLowerCase();
  const out = [];
  const swap = (a, b) => {
    if (x.endsWith(a) && x.length > a.length + 2) out.push(x.slice(0, -a.length) + b);
  };
  swap('isation', 'ization');
  swap('ization', 'isation');
  swap('ise', 'ize');
  swap('ize', 'ise');
  swap('yse', 'yze');
  swap('yze', 'yse');
  swap('our', 'or');
  if (x.endsWith('re') && x.length > 4) out.push(x.slice(0, -2) + 'er');
  if (x.includes('ae')) out.push(x.replace('ae', 'e'));
  if (x === 'wellbeing') out.push('well-being');
  if (x === 'axe') out.push('ax');
  if (x === 'cosy') out.push('cozy');
  if (x === 'distil') out.push('distill');
  return out;
}

function collocations(w) {
  if (!w.ex) return [];
  const tokens = w.ex.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  const idx = tokens.findIndex((t) => t.toLowerCase() === w.w.toLowerCase());
  if (idx < 0) return [];
  const cols = [];
  if (idx > 0) cols.push((tokens[idx - 1] + ' ' + tokens[idx]).toLowerCase());
  if (idx + 1 < tokens.length) cols.push((tokens[idx] + ' ' + tokens[idx + 1]).toLowerCase());
  return cols.filter((c) => c.split(' ').every((p) => p.length > 2 && !STOP.has(p))).slice(0, 2);
}

const extra = {};
const derived = [];
const variantFilled = [];

function slot(word) {
  if (!extra[word]) extra[word] = {};
  return extra[word];
}

for (const w of WORDS) {
  if (w.ipa) continue;
  const variant = spellingVariants(w.w).find((v) => by.get(v) && by.get(v).ipa && !by.get(v).ipa.includes('\\'));
  if (variant) {
    slot(w.w).ipa = by.get(variant).ipa;
    slot(w.w).ipaFrom = variant;
    variantFilled.push(w.w + ' ← ' + variant);
    continue;
  }
  const lemma = pluralLemma(w.w);
  if (!lemma) continue;
  const ipa = pluralIpa(by.get(lemma).ipa);
  if (!ipa) continue;
  slot(w.w).ipa = ipa;
  slot(w.w).ipaFrom = lemma + ' + plural';
  derived.push(w.w + ' ← ' + lemma);
}

let colCount = 0;
for (const w of WORDS) {
  const cols = collocations(w);
  if (!cols.length) continue;
  slot(w.w).col = cols;
  colCount += 1;
}

const confusable = new Map();
function addPair(a, b) {
  if (a === b || !by.has(a) || !by.has(b)) return;
  if (!confusable.has(a)) confusable.set(a, []);
  if (!confusable.has(b)) confusable.set(b, []);
  if (confusable.get(a).indexOf(b) < 0) confusable.get(a).push(b);
  if (confusable.get(b).indexOf(a) < 0) confusable.get(b).push(a);
}
for (const w of WORDS) {
  if (w.ipa) continue;
  for (const v of spellingVariants(w.w)) {
    if (by.has(v)) addPair(w.w.toLowerCase(), v);
  }
}
for (const [a, b] of KNOWN_PAIRS) addPair(a, b);
for (const [word, list] of confusable) {
  slot(word).conf = list.slice(0, 3);
}

for (const key of Object.keys(extra)) {
  const row = extra[key];
  if (!row.ipa) delete row.ipa;
  if (!row.ipaFrom) delete row.ipaFrom;
  if (!row.col || !row.col.length) delete row.col;
  if (!row.conf || !row.conf.length) delete row.conf;
  if (!Object.keys(row).length) delete extra[key];
}

const outPath = path.join(root, 'web/lexicon-extra.js');
const body = 'window.LEXICON_EXTRA=' + JSON.stringify(extra) + ';\n';
fs.writeFileSync(outPath, body);

const stillIpa = WORDS.filter((w) => !w.ipa && !(extra[w.w] && extra[w.w].ipa));
const corrupted = WORDS.filter((w) => w.ipa && (w.ipa.includes('\\') || !w.ipa.startsWith('/')));
const noExDef = WORDS.filter((w) => !w.ex && !w.def);

const lines = [];
lines.push('# 词库缺口');
lines.push('');
lines.push('生成脚本：`node tools/enrich_lexicon.js`。只从现有词条推导，不新写例句或释义。');
lines.push('');
lines.push('## 已补上');
lines.push('');
lines.push('- 拼写变体音标（英美拼写指向已有音标）：' + variantFilled.length);
lines.push('- 规则复数音标（词根音标 + /s/、/z/ 或 /ɪz/）：' + derived.length);
lines.push('- 从精编例句里抽出的搭配：' + colCount + ' 个词');
lines.push('- 易混词：词表里同时存在的固定对照，以及英美拼写对照');
lines.push('');
if (variantFilled.length) {
  lines.push('### 拼写变体');
  lines.push('');
  variantFilled.forEach((x) => lines.push('- ' + x));
  lines.push('');
}
lines.push('## 仍然没有音标（' + stillIpa.length + '）');
lines.push('');
lines.push('这些词在词表里没有可对照的词根或拼写变体，脚本没有猜。');
lines.push('');
stillIpa.forEach((w) => lines.push('- `' + w.w + '`（' + w.t + '）'));
lines.push('');
lines.push('## 音标字符串已损坏（' + corrupted.length + '）');
lines.push('');
lines.push('原字段里有多余的反斜杠，无法可靠还原元音，所以保留原样。');
lines.push('');
corrupted.forEach((w) => lines.push('- `' + w.w + '` ' + w.ipa));
lines.push('');
lines.push('## 没有例句也没有英文释义（' + noExDef.length + '）');
lines.push('');
lines.push('中文释义还在。没有现成英文例句或 ECDICT definition 可以抄，所以留空。');
lines.push('');
noExDef.forEach((w) => lines.push('- `' + w.w + '`（' + w.t + '）' + (w.zh ? '：' + w.zh : '')));
lines.push('');

fs.writeFileSync(path.join(root, 'CONTENT_GAPS.md'), lines.join('\n'));
console.log('extra', Object.keys(extra).length, 'derived', derived.length, 'variants', variantFilled.length, 'cols', colCount, 'stillIpa', stillIpa.length, 'corrupt', corrupted.length, 'noExDef', noExDef.length);
