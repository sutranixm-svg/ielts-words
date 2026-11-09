"""从 ECDICT 生成雅思/托福词表。

用法：
  python3 tools/gen_words.py ecdict.csv existing_words.json out.json

ecdict.csv 下载自 https://github.com/skywind3000/ECDICT （MIT 协议，约 63 MB）
existing_words.json 是从 web/words.js 里导出的既有词条，用来去重。
"""
import csv, json, re, sys, os

csv.field_size_limit(10**9)
SRC = sys.argv[1] if len(sys.argv) > 1 else 'ecdict.csv'
EXIST = json.load(open(sys.argv[2] if len(sys.argv) > 2 else 'existing720.json', encoding='utf-8'))
have = {w['w'].lower() for w in EXIST}

POS_MAP = [
    ('vt.', 'v.'), ('vi.', 'v.'), ('v.', 'v.'), ('n.', 'n.'), ('a.', 'adj.'),
    ('adj.', 'adj.'), ('ad.', 'adv.'), ('adv.', 'adv.'), ('prep.', 'prep.'),
    ('conj.', 'conj.'), ('pron.', 'pron.'), ('num.', 'num.'), ('int.', 'int.'),
    ('aux.', 'aux.'), ('abbr.', 'abbr.'),
]

def clean_pos(p):
    p = p.strip().lower()
    for k, v in POS_MAP:
        if p == k:
            return v
    return ''

def to_ipa(p):
    if not p:
        return ''
    s = p.strip()
    s = s.replace('ә', 'ə').replace("'", 'ˈ').replace(':', 'ː')
    s = s.replace('ɑ', 'ɑ').replace('ɡ', 'g')
    s = s.replace('є', 'e').replace('ɛ', 'e')
    s = re.sub(r'\s+', '', s)
    return '/' + s + '/'

def parse(row):
    tr = (row.get('translation') or '').strip()
    if not tr:
        return None
    lines = []
    for ln in re.split(r'\\n|\n', tr):
        ln = ln.strip()
        if not ln or ln.startswith('['):
            continue
        lines.append(ln)
    if not lines:
        return None
    meanings, poss = [], []
    for ln in lines[:2]:
        m = re.match(r'^([a-z]+\.)\s*(.*)$', ln)
        if m:
            pos = clean_pos(m.group(1))
            body = m.group(2).strip()
        else:
            pos, body = '', ln
        if not body:
            continue
        if pos and pos not in poss:
            poss.append(pos)
        meanings.append(body)
    if not meanings:
        return None
    zh = '，'.join(meanings)
    zh = re.sub(r'[，,]\s*', '；', zh)
    zh = re.sub(r'；+', '；', zh).strip('； ')
    if len(zh) > 70:
        zh = zh[:70].rsplit('；', 1)[0]
    if not zh:
        return None
    return '/'.join(poss), zh

out = []
stats = {'ielts': 0, 'toefl': 0, 'skip': 0}
WRE = re.compile(r"^[a-z][a-z' -]{1,22}$")
with open(SRC, encoding='utf-8', newline='') as f:
    for row in csv.DictReader(f):
        word = (row.get('word') or '').strip().lower()
        tags = (row.get('tag') or '').split()
        if 'ielts' not in tags and 'toefl' not in tags:
            continue
        if not WRE.match(word) or word in have:
            stats['skip'] += 1
            continue
        p = parse(row)
        if not p:
            stats['skip'] += 1
            continue
        poss, zh = p
        have.add(word)
        topic = 'ielts' if 'ielts' in tags else 'toefl'
        stats[topic] += 1
        out.append({'w': word, 'pos': poss, 'zh': zh, 'ipa': to_ipa(row.get('phonetic')),
                    't': topic})

print(json.dumps(stats), 'total new:', len(out))
json.dump(out, open(sys.argv[3] if len(sys.argv) > 3 else 'new_words.json', 'w', encoding='utf-8'), ensure_ascii=False)
for e in out[:3] + out[3000:3003]:
    print(e)
