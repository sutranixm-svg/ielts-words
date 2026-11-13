/* FSRS-5，按天调度。参数是开源实现里的默认权重，不联网。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FSRS = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  // https://github.com/open-spaced-repetition/ts-fsrs 默认权重（FSRS-5）
  const W = [
    0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575,
    0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
  ];
  const DECAY = -0.5;
  const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;

  function clamp(x, a, b) {
    return Math.min(b, Math.max(a, x));
  }

  function retrievability(elapsedDays, stability) {
    const s = stability || 0;
    if (s <= 0) return 0;
    const elapsed = Math.max(0, elapsedDays || 0);
    return Math.pow(1 + (FACTOR * elapsed) / s, DECAY);
  }

  function initStability(grade) {
    return Math.max(0.1, W[grade - 1]);
  }

  function initDifficulty(grade) {
    return clamp(W[4] - Math.exp(W[5] * (grade - 1)) + 1, 1, 10);
  }

  function nextDifficulty(d, grade) {
    const next = d - W[6] * (grade - 3);
    return clamp(W[7] * initDifficulty(4) + (1 - W[7]) * next, 1, 10);
  }

  function nextRecallStability(d, s, r, grade) {
    const hard = grade === 2 ? W[15] : 1;
    const easy = grade === 4 ? W[16] : 1;
    const growth = Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp((1 - r) * W[10]) - 1) * hard * easy;
    return s * (growth + 1);
  }

  function nextForgetStability(d, s, r) {
    return W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp((1 - r) * W[14]);
  }

  /** 目标保持率 0.9 时，间隔（天）等于稳定度。Again 固定明天，避免当天死循环。 */
  function scheduledDays(stability, grade) {
    if (grade === 1) return 1;
    return Math.max(1, Math.round(stability));
  }

  /**
   * @param card {stability, difficulty, reps, lapses}
   * @param grade 1 Again, 2 Hard, 3 Good, 4 Easy
   * @param elapsedDays 距上次复习的天数
   */
  function next(card, grade, elapsedDays) {
    const g = grade < 1 ? 1 : grade > 4 ? 4 : grade;
    const prevS = card && card.stability > 0 ? card.stability : 0;
    const reps = (card && card.reps) || 0;
    const lapses0 = (card && card.lapses) || 0;
    let stability;
    let difficulty;
    let state;
    let lapses = lapses0;
    if (!reps || prevS <= 0) {
      stability = initStability(g);
      difficulty = initDifficulty(g);
      state = g === 1 ? 'learning' : 'review';
      if (g === 1) lapses += 1;
    } else {
      const r = retrievability(elapsedDays || 0, prevS);
      difficulty = nextDifficulty(card.difficulty || initDifficulty(3), g);
      if (g === 1) {
        stability = Math.max(0.1, nextForgetStability(difficulty, prevS, r));
        state = 'relearning';
        lapses += 1;
      } else {
        stability = Math.max(prevS, nextRecallStability(difficulty, prevS, r, g));
        state = 'review';
      }
    }
    return {
      stability,
      difficulty,
      reps: reps + 1,
      lapses,
      state,
      scheduledDays: scheduledDays(stability, g),
      retrievability: prevS > 0 ? retrievability(elapsedDays || 0, prevS) : 0,
    };
  }

  return {
    next,
    retrievability,
    initStability,
    initDifficulty,
    scheduledDays,
    DECAY,
    FACTOR,
  };
});
