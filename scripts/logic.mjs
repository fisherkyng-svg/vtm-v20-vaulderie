// Pure V20 Vinculum rules. No Foundry globals here so it can be unit tested.

export const MIN = 1;
export const MAX = 10;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Every ordered (rater, target) pair among the participants. Vinculum is one-directional. */
export function pairs(ids) {
  const out = [];
  for (const rater of ids) for (const target of ids) if (rater !== target) out.push([rater, target]);
  return out;
}

/**
 * Apply one Vaulderie die to one Vinculum.
 *  - No rating yet: the die becomes the starting rating.
 *  - Die higher than the rating: +1 (max 10).
 *  - Die of 1: -1 (min 1).
 *  - Otherwise unchanged.
 */
export function resolve(current, die) {
  if (!Number.isInteger(die) || die < 1 || die > 10) throw new RangeError(`die must be 1-10, got ${die}`);
  if (current == null) return { from: null, to: die, kind: 'initial' };
  const cur = clamp(Math.round(current), MIN, MAX);
  if (die === 1) return cur > MIN ? { from: cur, to: cur - 1, kind: 'drop' } : { from: cur, to: cur, kind: 'hold' };
  if (die > cur) return { from: cur, to: cur + 1, kind: 'rise' };
  return { from: cur, to: cur, kind: 'hold' };
}

/** Modifiers that apply to `targetId` right now. A modifier targets one vampire or 'all'. */
export function activeMods(mods, targetId, now) {
  return (mods ?? []).filter(m =>
    (m.target === 'all' || m.target === targetId) && (m.until == null || now < m.until));
}

/** Rating after temporary modifiers. Can fall to 0 (e.g. Dissociate on a Vinculum of 2). */
export function effective(rating, mods, targetId, now) {
  if (rating == null) return null;
  const delta = activeMods(mods, targetId, now).reduce((s, m) => s + (Number(m.delta) || 0), 0);
  return clamp(rating + delta, 0, MAX);
}

/** V20 successes: dice at or above difficulty, each 1 cancels one success. */
export function successes(results, difficulty) {
  const hits = results.filter(r => r >= difficulty).length;
  const ones = results.filter(r => r === 1).length;
  return { hits, ones, net: hits - ones, botch: hits === 0 && ones > 0 };
}

/**
 * Vinculum conflict: each party rolls the character's Vinculum toward them,
 * difficulty 5 for the party favored regardless of Vinculum, 7 for the rest.
 * Most net successes wins. Returns winners (ties possible) or none if nobody scored.
 */
export function conflictOutcome(entries) {
  const best = Math.max(...entries.map(e => e.net));
  if (!entries.length || best <= 0) return { winners: [], tie: false };
  const winners = entries.filter(e => e.net === best).map(e => e.id);
  return { winners, tie: winners.length > 1 };
}

export const conflictDifficulty = favored => (favored ? 5 : 7);

/** Parse a matrix cell: '' -> null (no Vinculum), 1-10 -> number, anything else -> undefined (invalid). */
export function parseRating(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < MIN || n > MAX) return undefined;
  return n;
}
