import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../scripts/logic.mjs';

test('pairs are ordered and exclude self', () => {
  assert.deepEqual(L.pairs(['a', 'b', 'c']).length, 6);
  assert.ok(!L.pairs(['a', 'b']).some(([r, t]) => r === t));
});

test('no rating: the die is the starting Vinculum', () => {
  assert.deepEqual(L.resolve(null, 7), { from: null, to: 7, kind: 'initial' });
  assert.deepEqual(L.resolve(undefined, 1), { from: null, to: 1, kind: 'initial' });
});

test('higher than current rises by one, capped at 10', () => {
  assert.deepEqual(L.resolve(4, 7), { from: 4, to: 5, kind: 'rise' });
  assert.deepEqual(L.resolve(9, 10), { from: 9, to: 10, kind: 'rise' });
  assert.equal(L.resolve(10, 10).kind, 'hold');
});

test('equal or lower holds', () => {
  assert.equal(L.resolve(5, 5).kind, 'hold');
  assert.equal(L.resolve(5, 2).to, 5);
});

test('a 1 drops by one, floored at 1', () => {
  assert.deepEqual(L.resolve(5, 1), { from: 5, to: 4, kind: 'drop' });
  assert.deepEqual(L.resolve(1, 1), { from: 1, to: 1, kind: 'hold' });
});

test('invalid die throws', () => {
  assert.throws(() => L.resolve(3, 0));
  assert.throws(() => L.resolve(3, 11));
});

test('modifiers: target, all, and expiry', () => {
  const mods = [
    { target: 'all', delta: -3, until: 100 },
    { target: 'b', delta: 1, until: null },
  ];
  assert.equal(L.effective(5, mods, 'b', 50), 3);
  assert.equal(L.effective(5, mods, 'c', 50), 2);
  assert.equal(L.effective(5, mods, 'c', 150), 5);
  assert.equal(L.effective(2, mods, 'c', 50), 0);
  assert.equal(L.effective(null, mods, 'c', 50), null);
});

test('successes: ones cancel, botch detected', () => {
  assert.deepEqual(L.successes([5, 7, 1, 3], 5), { hits: 2, ones: 1, net: 1, botch: false });
  assert.equal(L.successes([1, 2], 7).botch, true);
});

test('conflict outcome: winner, tie, nobody', () => {
  assert.deepEqual(L.conflictOutcome([{ id: 'a', net: 2 }, { id: 'b', net: 1 }]), { winners: ['a'], tie: false });
  assert.equal(L.conflictOutcome([{ id: 'a', net: 2 }, { id: 'b', net: 2 }]).tie, true);
  assert.deepEqual(L.conflictOutcome([{ id: 'a', net: 0 }, { id: 'b', net: -1 }]).winners, []);
  assert.equal(L.conflictDifficulty(true), 5);
  assert.equal(L.conflictDifficulty(false), 7);
});

test('parseRating', () => {
  assert.equal(L.parseRating(''), null);
  assert.equal(L.parseRating(' 6 '), 6);
  assert.equal(L.parseRating('0'), undefined);
  assert.equal(L.parseRating('11'), undefined);
  assert.equal(L.parseRating('x'), undefined);
});
