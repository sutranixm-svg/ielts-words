#!/usr/bin/env python3
"""每日外刊采集：抓 RSS → 选 10 条 → 翻译标题和摘要 → 写 data/articles.json

只保存标题、摘要、链接和署名，不保存全文。
翻译优先走 Google 的公开端点，失败时退到 MyMemory；两者都失败就保留英文。
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime

UA = "Mozilla/5.0 (compatible; ielts-words-daily/1.0)"

# 分类 -> [(来源名, RSS 地址, 权重)]
FEEDS = {
    "tech": [
        ("TechCrunch", "https://techcrunch.com/feed/", 3),
        ("The Verge", "https://www.theverge.com/rss/index.xml", 3),
        ("Ars Technica", "https://feeds.arstechnica.com/arstechnica/index", 2),
    ],
    "business": [
        ("CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.html", 3),
        ("MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories", 2),
        ("BBC Business", "https://feeds.bbci.co.uk/news/business/rss.xml", 2),
    ],
    "life": [
        ("The Guardian", "https://www.theguardian.com/lifeandstyle/rss", 3),
        ("BBC Health", "https://feeds.bbci.co.uk/news/health/rss.xml", 2),
    ],
    "culture": [
        ("Variety", "https://variety.com/feed/", 3),
        ("BBC Entertainment", "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml", 2),
    ],
}

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "articles.json")
TARGET = 10
MAX_AGE_DAYS = 4


def fetch(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def strip_html(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    s = (s.replace("&nbsp;", " ").replace("&amp;", "&").replace("&quot;", '"')
          .replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">"))
    return re.sub(r"\s+", " ", s).strip()


def parse_date(s):
    if not s:
        return None
    s = s.strip()
    try:
        return parsedate_to_datetime(s).astimezone(timezone.utc)
    except Exception:
        pass
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M%z"):
        try:
            dt = datetime.strptime(s, fmt)
            return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except Exception:
            continue
    return None


def parse_feed(raw):
    """兼容 RSS 2.0 和 Atom。"""
    items = []
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return items
    ns = {"atom": "http://www.w3.org/2005/Atom"}

    for it in root.iter("item"):
        title = strip_html(it.findtext("title") or "")
        link = (it.findtext("link") or "").strip()
        desc = strip_html(it.findtext("description") or "")
        pub = parse_date(it.findtext("pubDate") or "")
        if title and link:
            items.append({"title": title, "url": link, "summary": desc, "pub": pub})

    for it in root.iter("{http://www.w3.org/2005/Atom}entry"):
        title = strip_html(it.findtext("{http://www.w3.org/2005/Atom}title") or "")
        link = ""
        for ln in it.findall("{http://www.w3.org/2005/Atom}link"):
            if ln.get("rel") in (None, "alternate"):
                link = ln.get("href") or ""
                break
        desc = strip_html(it.findtext("{http://www.w3.org/2005/Atom}summary")
                          or it.findtext("{http://www.w3.org/2005/Atom}content") or "")
        pub = parse_date(it.findtext("{http://www.w3.org/2005/Atom}published")
                         or it.findtext("{http://www.w3.org/2005/Atom}updated") or "")
        if title and link:
            items.append({"title": title, "url": link, "summary": desc, "pub": pub})
    return items


def shorten(text, limit=280):
    text = re.sub(r"\s+", " ", text or "").strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    for sep in (". ", "! ", "? "):
        i = cut.rfind(sep)
        if i > limit * 0.5:
            return cut[:i + 1].strip()
    return cut.rsplit(" ", 1)[0].rstrip(",;:") + "…"


def gtx(text, src="en", dst="zh-CN"):
    q = urllib.parse.quote(text[:1800])
    url = ("https://translate.googleapis.com/translate_a/single"
           "?client=gtx&sl=%s&tl=%s&dt=t&q=%s" % (src, dst, q))
    raw = json.loads(fetch(url, timeout=20).decode("utf-8"))
    return "".join(seg[0] for seg in raw[0] if seg and seg[0]).strip()


def mymemory(text, src="en", dst="zh-CN"):
    q = urllib.parse.quote(text[:480])
    url = "https://api.mymemory.translated.net/get?q=%s&langpair=%s|%s" % (q, src, dst)
    raw = json.loads(fetch(url, timeout=20).decode("utf-8"))
    t = (raw.get("responseData") or {}).get("translatedText") or ""
    return t.strip()


def translate(text):
    text = (text or "").strip()
    if not text or not re.search(r"[A-Za-z]{3}", text):
        return ""
    for fn in (gtx, mymemory):
        try:
            out = fn(text)
            if out and re.search(r"[\u4e00-\u9fff]", out):
                return out
        except Exception:
            pass
    return ""


def translate_many(texts, workers=6, budget=300):
    """并发翻译一批文本，整体限时，超时的条目保留英文。"""
    uniq = [t for t in dict.fromkeys(texts) if t]
    out = {}
    if not uniq:
        return out
    started = time.time()
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(translate, t): t for t in uniq}
        for fut, t in futs.items():
            left = budget - (time.time() - started)
            if left <= 1:
                break
            try:
                out[t] = fut.result(timeout=left)
            except Exception:
                out[t] = ""
    return out


def main():
    now = datetime.now(timezone.utc)
    t0 = time.time()
    cutoff = now - timedelta(days=MAX_AGE_DAYS)
    pool = []

    for cat, feeds in FEEDS.items():
        for name, url, weight in feeds:
            try:
                raw = fetch(url)
                items = parse_feed(raw)
            except Exception as e:
                print("skip %-16s %s" % (name, type(e).__name__), file=sys.stderr)
                continue
            fresh = [i for i in items if i["pub"] and i["pub"] >= cutoff]
            fresh.sort(key=lambda x: x["pub"], reverse=True)
            for rank, it in enumerate(fresh[:8]):
                pool.append({
                    "cat": cat, "src": name, "title": it["title"], "url": it["url"],
                    "summary": it["summary"], "pub": it["pub"],
                    "score": weight * 100 - rank * 5,
                })
            print("%-16s %2d/%2d" % (name, len(fresh[:8]), len(items)), file=sys.stderr)

    # 去重：同域名 + 标题前 6 个词相同视为同一条
    seen, uniq = set(), []
    for it in sorted(pool, key=lambda x: x["score"], reverse=True):
        host = urllib.parse.urlparse(it["url"]).netloc.replace("www.", "")
        key = (host, " ".join(re.findall(r"[a-zA-Z]+", it["title"].lower())[:6]))
        if key in seen:
            continue
        seen.add(key)
        uniq.append(it)

    # 分类均衡：每类最多 3 条，轮流取，最后按分数补齐到 10 条
    by_cat = {}
    for it in uniq:
        by_cat.setdefault(it["cat"], []).append(it)
    cats = [c for c in FEEDS if by_cat.get(c)]
    cap = max(1, TARGET // max(1, len(cats))) + (1 if TARGET % max(1, len(cats)) else 0)
    picked, taken = [], set()
    depth = 0
    while len(picked) < TARGET and cats and depth < 20:
        progressed = False
        for cat in cats:
            if len(picked) >= TARGET:
                break
            if sum(1 for p in picked if p["cat"] == cat) >= cap:
                continue
            lst = by_cat[cat]
            if depth < len(lst):
                picked.append(lst[depth])
                taken.add(id(lst[depth]))
                progressed = True
        depth += 1
        if not progressed:
            break
    for it in uniq:
        if len(picked) >= TARGET:
            break
        if id(it) not in taken:
            picked.append(it)
            taken.add(id(it))
    picked = picked[:TARGET]

    # 按发布时间排，最新的在前
    picked.sort(key=lambda x: x["pub"] or now, reverse=True)

    prepared = []
    for it in picked:
        summary = shorten(it["summary"])
        if len(summary.split()) < 12:
            summary = shorten(it["summary"] + " " + it["title"], 240)
        prepared.append((it, summary))

    texts = []
    for it, summary in prepared:
        texts += [it["title"], summary]
    tr = translate_many(texts)

    out = {"generated": now.isoformat(timespec="seconds"), "count": len(picked), "items": []}
    for n, (it, summary) in enumerate(prepared, 1):
        title_zh = tr.get(it["title"], "")
        summary_zh = tr.get(summary, "")
        out["items"].append({
            "id": "%s-%02d" % (now.strftime("%Y%m%d"), n),
            "cat": it["cat"],
            "src": it["src"],
            "title": it["title"],
            "title_zh": title_zh,
            "summary": summary,
            "summary_zh": summary_zh,
            "url": it["url"],
            "pub": (it["pub"] or now).isoformat(timespec="seconds"),
            "words": len(re.findall(r"[A-Za-z']+", summary)),
        })
        print("%02d [%s] %s | zh:%s" % (n, it["cat"], it["title"][:56], "Y" if title_zh else "N"), file=sys.stderr)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("wrote %s (%d items)" % (os.path.normpath(OUT), len(out["items"])), file=sys.stderr)


if __name__ == "__main__":
    main()
