/* Recommended study path. Schedule math only: which AWL families are new
   on a plan day, and which earlier groups fall on review nodes 1, 2, 4, 7, 15.
   Definitions live in the word bank / PATH_DATA, not here. */
(function () {
  const DATA = window.PATH_DATA || { awl: [], gk: [], cet4: [], extra: [], senses: {}, missingAwl: [] };
  const BATCH = 25;
  const NODES = [1, 2, 4, 7, 15];
  const STAGES = [
    {
      id: 1,
      title: '高中词汇',
      band: '约 5.5–6',
      decks: ['gk'],
      blurb: '先把高中词汇学扎实。这一阶段整套练习可以先少做。',
    },
    {
      id: 2,
      title: '学术词表',
      band: '约 6–6.5',
      decks: ['awl'],
      blurb: '学术词族按组引入。记忆仍用原来的 FSRS，计划只决定今天出现哪些词族。',
    },
    {
      id: 3,
      title: '学术核心',
      band: '约 6.5–7.5',
      decks: [],
      gap: true,
      blurb: '这一档通常还要一份学术核心词表。没有找到可以随应用分发的公开 538 词表，所以没有内置。听力答案词和复盘生词继续留在这一阶段。',
    },
    {
      id: 4,
      title: '四级词汇',
      band: '约 7.5–9',
      decks: ['cet4'],
      blurb: '前面的阶段走完之后，用四级词汇把覆盖面补上。',
    },
  ];

  function familyCount() {
    return DATA.awl.length;
  }

  function sublistOfIndex(index) {
    const fam = DATA.awl[index];
    if (!fam) return null;
    let pos = 1;
    for (let i = 0; i < index; i += 1) {
      if (DATA.awl[i].sub === fam.sub) pos += 1;
    }
    return { sub: fam.sub, pos: pos };
  }

  function rangeLabel(start, end) {
    const parts = [];
    let cur = null;
    for (let i = start; i < end; i += 1) {
      const sp = sublistOfIndex(i);
      if (!sp) break;
      if (!cur || cur.sub !== sp.sub) {
        if (cur) parts.push(cur);
        cur = { sub: sp.sub, from: sp.pos, to: sp.pos };
      } else {
        cur.to = sp.pos;
      }
    }
    if (cur) parts.push(cur);
    return parts.map(function (p) {
      return 'Sublist ' + p.sub + '（' + p.from + '–' + p.to + '）';
    }).join(' + ');
  }

  function listSpan(listNo, limit) {
    const n = Math.min(limit || familyCount(), familyCount());
    const start = (listNo - 1) * BATCH;
    const end = Math.min(n, start + BATCH);
    return { list: listNo, start: start, end: Math.max(start, end), count: Math.max(0, end - start) };
  }

  function listCount(limit) {
    const n = Math.min(limit || familyCount(), familyCount());
    return n ? Math.ceil(n / BATCH) : 0;
  }

  function reviewsFor(listNo) {
    const out = [];
    for (let prev = 1; prev < listNo; prev += 1) {
      const gap = listNo - prev;
      if (NODES.indexOf(gap) >= 0) out.push({ list: prev, node: gap });
    }
    out.sort(function (a, b) { return a.node - b.node || a.list - b.list; });
    return out;
  }

  function planRow(listNo, limit) {
    const span = listSpan(listNo, limit);
    const first = DATA.awl[span.start];
    return {
      list: listNo,
      start: span.start,
      end: span.end,
      count: span.count,
      label: rangeLabel(span.start, span.end),
      familyFrom: span.count ? span.start + 1 : 0,
      familyTo: span.end,
      reviews: reviewsFor(listNo),
      selfCheck: listNo === 1,
      priority: first ? priorityOf(first.sub) : '',
    };
  }

  function fullSchedule(limit) {
    const rows = [];
    const n = listCount(limit);
    for (let i = 1; i <= n; i += 1) rows.push(planRow(i, limit));
    return rows;
  }

  function dueLists(started, today, dayDiff) {
    const out = [];
    const map = started || {};
    Object.keys(map).forEach(function (key) {
      const listNo = Number(key);
      if (!listNo || !map[key]) return;
      const gap = dayDiff(map[key], today);
      if (NODES.indexOf(gap) >= 0) out.push({ list: listNo, node: gap, started: map[key] });
    });
    out.sort(function (a, b) { return a.node - b.node || a.list - b.list; });
    return out;
  }

  function stageForBand(band) {
    const n = Number(band);
    if (!isFinite(n)) return 1;
    if (n < 6) return 1;
    if (n < 6.5) return 2;
    if (n < 7.5) return 3;
    return 4;
  }

  function priorityOf(sub) {
    if (sub <= 3) return '优先';
    if (sub <= 6) return '接下来';
    return '按目标选学';
  }

  function reviewText(reviews) {
    if (!reviews || !reviews.length) return '';
    return reviews.map(function (r) {
      return '第 ' + r.list + ' 组 · 第 ' + r.node + ' 天';
    }).join('、');
  }

  window.PATH = {
    DATA: DATA,
    BATCH: BATCH,
    NODES: NODES,
    STAGES: STAGES,
    familyCount: familyCount,
    listSpan: listSpan,
    listCount: listCount,
    planRow: planRow,
    fullSchedule: fullSchedule,
    dueLists: dueLists,
    reviewsFor: reviewsFor,
    rangeLabel: rangeLabel,
    stageForBand: stageForBand,
    priorityOf: priorityOf,
    reviewText: reviewText,
  };
})();
