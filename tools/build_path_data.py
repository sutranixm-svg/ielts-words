#!/usr/bin/env python3
"""Build web/path-data.js from the Coxhead AWL and ECDICT.

Sources (not copied from any course article):
  data/awl.json
    Academic Word List, 570 word families in 10 sublists.
    Machine-readable families (CC0) from
    https://github.com/lpmi-13/machine_readable_wordlists
    which transcribes the list published by Averil Coxhead /
    Victoria University of Wellington:
    https://www.wgtn.ac.nz/lals/resources/academicwordlist
  ecdict.csv
    https://github.com/skywind3000/ECDICT (MIT).
    Tags used: gk (高考 / high-school) and cet4 (大学英语四级).
    Glosses are copied from ECDICT translation / phonetic / definition.
    Nothing is invented. Words already in web/words.js are reused.

Usage:
  python3 tools/build_path_data.py /path/to/ecdict.csv
"""
import csv
import json
import re
import sys

csv.field_size_limit(10 ** 9)

ROOT_WORDS = 'web/words.js'
AWL_PATH = 'data/awl.json'
OUT_PATH = 'web/path-data.js'

WRE = re.compile(r"^[a-z][a-z' .-]{0,40}$")
HYPHENS = {
    '\u2010': '-',
    '\u2011': '-',
    '\u2012': '-',
    '\u2013': '-',
    '\u2014': '-',
}


def norm(word):
    s = (word or '').strip().lower()
    for a, b in HYPHENS.items():
        s = s.replace(a, b)
    return re.sub(r'\s+', ' ', s)


def sense_lines(translation):
    lines = []
    for ln in re.split(r'\\n|\n', translation or ''):
        ln = ln.strip()
        if not ln or ln.startswith('['):
            continue
        ln = re.sub(r'\s+', ' ', ln)
        if len(ln) > 90:
            cut = ln[:90]
            if ',' in cut:
                cut = cut.rsplit(',', 1)[0]
            ln = cut.strip(' ,;')
        if ln:
            lines.append(ln)
        if len(lines) >= 4:
            break
    return lines


def short_zh(lines):
    meanings = []
    poss = []
    for ln in lines[:2]:
        m = re.match(r'^([A-Za-z]+\.)\s*(.*)$', ln)
        if m:
            pos = m.group(1).lower()
            body = m.group(2).strip()
        else:
            pos, body = '', ln
        body = body.split('[')[0].strip(' ,;')
        if not body:
            continue
        if pos and pos not in poss:
            poss.append(pos)
        meanings.append(body)
    zh = '；'.join(meanings)
    zh = re.sub(r'[，,]\s*', '；', zh)
    zh = re.sub(r'；+', '；', zh).strip('； ')
    if len(zh) > 70:
        zh = zh[:70].rsplit('；', 1)[0].strip('； ')
    return '/'.join(poss), zh


def to_ipa(phonetic):
    if not phonetic:
        return ''
    s = phonetic.strip()
    s = s.replace('ә', 'ə').replace("'", 'ˈ').replace(':', 'ː')
    s = re.sub(r'\s+', '', s)
    if not s or s == '/':
        return ''
    return '/' + s.strip('/') + '/'


def load_bank():
    raw = open(ROOT_WORDS, encoding='utf-8').read()
    payload = raw.split('window.WORDS=', 1)[1].strip()
    if payload.endswith(';'):
        payload = payload[:-1]
    words = json.loads(payload)
    by_norm = {}
    for w in words:
        key = norm(w.get('w'))
        if key and key not in by_norm:
            by_norm[key] = w
    return by_norm


def load_awl():
    data = json.load(open(AWL_PATH, encoding='utf-8'))
    families = []
    forms = set()
    for i in range(1, 11):
        block = data['sublist_%d' % i]
        for head, info in block.items():
            members = [norm(head)]
            for sub in (info.get('subwords') or []):
                n = norm(sub)
                if n and n not in members:
                    members.append(n)
            families.append({'h': norm(head), 'sub': i, 'members': members})
            forms.update(members)
    return families, forms


# Closed-class words stay on the list but after content words, so the
# daily queue is not "the / of / have" for the first week.
CLOSED = set('''a an the of to in on for and or but if as at by be is are was were been being
have has had do does did this that these those it its they them their he she we you i
my our your his her with from what which who whom whose would could should will can may
not no nor so than then there here when where why how about into over after before
also just only very more most some any each both few such'''.split())


def frq_key(rec, word):
    frq = 0
    if rec:
        try:
            frq = int(rec.get('frq') or 0)
        except ValueError:
            frq = 0
    return (0 if frq > 0 else 1, frq if frq > 0 else 10 ** 9, word)


def main():
    if len(sys.argv) < 2:
        sys.exit('usage: build_path_data.py ecdict.csv')
    ecdict_path = sys.argv[1]
    bank = load_bank()
    families, awl_forms = load_awl()
    if len(families) != 570:
        sys.exit('expected 570 AWL families, got %d' % len(families))

    records = {}
    with open(ecdict_path, encoding='utf-8', newline='') as handle:
        for row in csv.DictReader(handle):
            word = norm(row.get('word'))
            if not word or not WRE.match(word):
                continue
            tags = set((row.get('tag') or '').split())
            if 'gk' not in tags and 'cet4' not in tags and word not in awl_forms:
                continue
            prev = records.get(word)
            candidate = {
                'phonetic': row.get('phonetic') or '',
                'definition': row.get('definition') or '',
                'translation': row.get('translation') or '',
                'frq': row.get('frq') or '0',
                'tags': tags,
            }
            if prev is None:
                records[word] = candidate
                continue
            prev['tags'] |= tags
            if sense_lines(candidate['translation']) and not sense_lines(prev['translation']):
                prev['translation'] = candidate['translation']
                prev['phonetic'] = candidate['phonetic'] or prev['phonetic']
                prev['definition'] = candidate['definition'] or prev['definition']
            if frq_key(candidate, word) < frq_key(prev, word):
                prev['frq'] = candidate['frq']

    def gloss_of(word):
        rec = records.get(word)
        if not rec:
            return []
        return sense_lines(rec['translation'])

    extras = {}
    senses = {}
    missing = []
    awl_out = []

    def bank_spelling(word):
        item = bank.get(word)
        return item.get('w') if item else None

    for fam in families:
        in_bank = []
        for member in fam['members']:
            spelling = bank_spelling(member)
            if spelling and spelling not in in_bank:
                in_bank.append(spelling)
        rep = None
        if bank_spelling(fam['h']):
            rep = bank_spelling(fam['h'])
        elif in_bank:
            rep = min(in_bank, key=lambda sp: frq_key(records.get(norm(sp)), norm(sp)))
        else:
            cands = [m for m in fam['members'] if gloss_of(m)]
            if cands:
                chosen = min(cands, key=lambda m: frq_key(records.get(m), m))
                extras[chosen] = records[chosen]
                rep = chosen
        if not rep:
            missing.append(fam['h'])
            awl_out.append({'h': fam['h'], 'sub': fam['sub'], 'rep': '', 'forms': []})
            continue
        forms = []
        for member in fam['members']:
            spelling = bank_spelling(member)
            if not spelling or spelling == rep or spelling in forms:
                continue
            forms.append(spelling)
            if len(forms) >= 8:
                break
        awl_out.append({'h': fam['h'], 'sub': fam['sub'], 'rep': rep, 'forms': forms})
        if rep in bank and not bank[rep].get('ex'):
            lines = gloss_of(norm(rep))
            if len(lines) >= 2:
                senses[rep] = lines

    def collect(tag):
        found = []
        for word, rec in records.items():
            if tag not in rec['tags']:
                continue
            if not gloss_of(word) and word not in bank:
                continue
            if word not in bank and not gloss_of(word):
                continue
            if word not in bank:
                if not gloss_of(word):
                    continue
                extras[word] = rec
                spelling = word
            else:
                spelling = bank_spelling(word)
            short = 1 if len(spelling) < 4 and ' ' not in spelling else 0
            closed = 1 if spelling in CLOSED else 0
            found.append(((closed, short) + frq_key(rec, spelling), spelling))
        found.sort()
        out = []
        seen = set()
        for _, spelling in found:
            if spelling in seen:
                continue
            seen.add(spelling)
            out.append(spelling)
        return out

    gk = collect('gk')
    cet4 = collect('cet4')

    extra_out = []
    for word in sorted(extras):
        rec = extras[word]
        lines = sense_lines(rec['translation'])
        pos, zh = short_zh(lines)
        if not zh:
            continue
        item = {'w': word, 'pos': pos, 'zh': zh}
        ipa = to_ipa(rec.get('phonetic'))
        if ipa:
            item['ipa'] = ipa
        definition = re.sub(r'\s+', ' ', (rec.get('definition') or '')).strip()
        if definition:
            item['def'] = definition[:180].rsplit(' ', 1)[0] if len(definition) > 180 else definition
        if len(lines) >= 2:
            item['senses'] = lines
        extra_out.append(item)

    # Drop AWL senses that would point at a word we failed to keep.
    extra_words = {item['w'] for item in extra_out}
    for fam in awl_out:
        if fam['rep'] and fam['rep'] not in bank and fam['rep'] not in extra_words:
            missing.append(fam['h'])
            fam['rep'] = ''

    payload = {
        'awl': awl_out,
        'gk': gk,
        'cet4': cet4,
        'extra': extra_out,
        'senses': senses,
        'missingAwl': sorted(set(missing)),
    }
    text = (
        '/* Generated by tools/build_path_data.py. Do not hand-edit.\n'
        '   AWL: Coxhead 570 families (data/awl.json, CC0 transcription of the\n'
        '   Victoria University of Wellington list). Within each sublist the\n'
        '   order is alphabetical, then sublists 1 to 10.\n'
        '   High-school list: ECDICT tag gk. CET-4 list: ECDICT tag cet4 (MIT).\n'
        '   Glosses come from the existing word bank or from ECDICT fields.\n'
        '   No example sentences were written for this file. */\n'
        'window.PATH_DATA=' + json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + ';\n'
    )
    open(OUT_PATH, 'w', encoding='utf-8').write(text)
    reps = [f for f in awl_out if f['rep']]
    subs = {}
    for f in awl_out:
        subs[f['sub']] = subs.get(f['sub'], 0) + 1
    print(json.dumps({
        'awl': len(awl_out),
        'awlWithRep': len(reps),
        'missing': payload['missingAwl'],
        'sublists': subs,
        'gk': len(gk),
        'cet4': len(cet4),
        'extra': len(extra_out),
        'senses': len(senses),
        'bytes': len(text.encode('utf-8')),
        'gk0': gk[:8],
        'cet0': cet4[:5],
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
