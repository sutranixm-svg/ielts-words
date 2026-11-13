const F = require('../web/fsrs.js');
const assert = (c, m) => {
  if (!c) throw new Error(m);
  console.log('ok  ' + m);
};

const firstGood = F.next({ stability: 0, difficulty: 0, reps: 0, lapses: 0 }, 3, 0);
assert(firstGood.scheduledDays >= 2 && firstGood.stability > 2, '新词选认识会排到至少 2 天');
const again = F.next({ stability: 4, difficulty: 5, reps: 2, lapses: 0 }, 1, 2);
assert(again.scheduledDays === 1 && again.lapses === 1, 'Again 固定明天，并记一次 lapse');
const hard = F.next({ stability: 4, difficulty: 5, reps: 2, lapses: 0 }, 2, 4);
const good = F.next({ stability: 4, difficulty: 5, reps: 2, lapses: 0 }, 3, 4);
const easy = F.next({ stability: 4, difficulty: 5, reps: 2, lapses: 0 }, 4, 4);
assert(good.stability >= hard.stability && easy.stability >= good.stability, 'Hard < Good < Easy 的稳定度');
const fresh = F.retrievability(0, 5);
assert(Math.abs(fresh - 1) < 1e-9, '刚复习完可提取性是 1');
const later = F.retrievability(5, 5);
assert(later < fresh && later > 0.5, '过了稳定度那么多天，可提取性下降');
console.log('\nFSRS TEST PASS');
