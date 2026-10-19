// Runs the real module against a minimal Foundry mock with scripted dice.
import test from 'node:test';
import assert from 'node:assert/strict';

const MOD = 'vtm-v20-vaulderie';
const hooks = {};
const setProp = (o, path, v) => { const k = path.split('.'); const last = k.pop(); let t = o; for (const p of k) t = (t[p] ??= {}); t[last] = v; };
const getProp = (o, path) => path.split('.').reduce((a, k) => a?.[k], o);

class Actor {
  constructor({ id, name, type, pc }) { Object.assign(this, { id, name, type, hasPlayerOwner: !!pc, isOwner: true, flags: {} }); }
  getFlag(scope, key) { return structuredClone(getProp(this.flags, `${scope}.${key}`)); }
  async setFlag(scope, key, v) { setProp(this.flags, `${scope}.${key}`, structuredClone(v)); }
  async update(upd) { for (const [k, v] of Object.entries(upd)) setProp(this, k, structuredClone(v)); }
}

let diceQueue = [];
const chat = [];
const settings = { [`${MOD}.runs`]: [], [`${MOD}.publicResults`]: false };
const actors = [
  new Actor({ id: 'moth', name: 'Moth', type: 'vampire', pc: true }),
  new Actor({ id: 'enzo', name: 'Enzo Polonia', type: 'vampire', pc: true }),
  new Actor({ id: 'niven', name: 'Niven Lytton', type: 'vampire', pc: true }),
  new Actor({ id: 'ghoul', name: 'Renfield', type: 'ghoul', pc: false }),
];
const collection = Object.assign([...actors], { get: id => actors.find(a => a.id === id) });
const moduleObj = {};

globalThis.Hooks = { once: (n, f) => (hooks[n] ??= []).push(f), on: (n, f) => (hooks[n] ??= []).push(f) };
globalThis.Roll = class {
  constructor(f) { this.n = Number(f.split('d')[0]); }
  async evaluate() { this.dice = [{ results: diceQueue.splice(0, this.n).map(result => ({ result })) }]; return this; }
};
globalThis.ChatMessage = {
  create: async d => chat.push(d), getSpeaker: ({ actor }) => ({ alias: actor.name }), applyRollMode: () => {},
};
globalThis.CONFIG = { sounds: {} };
globalThis.ui = { notifications: { warn: () => {}, info: () => {} } };
globalThis.canvas = { tokens: { controlled: [] } };
globalThis.foundry = {
  applications: { api: { DialogV2: { wait: async () => null } } },
  utils: { deepClone: structuredClone, randomID: () => Math.random().toString(36).slice(2, 10) },
};
globalThis.game = {
  user: { isGM: true, name: 'GM' }, users: [{ id: 'gm', isGM: true }], system: { id: 'vtm-v20' },
  actors: collection, time: { worldTime: 0 },
  modules: { get: () => moduleObj },
  settings: { register() {}, get: (m, k) => settings[`${m}.${k}`], set: async (m, k, v) => { settings[`${m}.${k}`] = v; } },
};

await import('../scripts/main.mjs');
hooks.init.forEach(f => f());
const api = moduleObj.api;
const r = (a, b) => api.rating(collection.get(a), b);

test('first Vaulderie sets starting ratings from the dice; ghouls ignored', async () => {
  diceQueue = [3, 5, 7, 2, 9, 4]; // moth>enzo, moth>niven, enzo>moth, enzo>niven, niven>moth, niven>enzo
  await api.runVaulderie(['moth', 'enzo', 'niven', 'ghoul'], { publicCard: false });
  assert.equal(r('moth', 'enzo'), 3);
  assert.equal(r('niven', 'enzo'), 4);
  assert.equal(r('ghoul', 'moth'), null);
  assert.equal(r('moth', 'ghoul'), null);
  assert.deepEqual(chat.at(-1).whisper, ['gm']);
  assert.ok(collection.get('moth').getFlag(MOD, 'lastVaulderie'));
});

test('second Vaulderie: above rises, 1 drops, else holds', async () => {
  diceQueue = [8, 1, 7, 2, 10, 4];
  await api.runVaulderie(['moth', 'enzo', 'niven']);
  assert.equal(r('moth', 'enzo'), 4);  // 8 > 3
  assert.equal(r('moth', 'niven'), 4); // 1 drops 5
  assert.equal(r('enzo', 'moth'), 7);  // 7 = 7 holds
  assert.equal(r('enzo', 'niven'), 2); // 2 = 2 holds
  assert.equal(r('niven', 'moth'), 10);
  assert.equal(r('niven', 'enzo'), 4);
});

test('undo restores the previous ratings', async () => {
  await api.undoRun(settings[`${MOD}.runs`][0].id);
  assert.equal(r('moth', 'enzo'), 3);
  assert.equal(r('moth', 'niven'), 5);
  assert.equal(r('niven', 'moth'), 9);
});

test('new member: only new pairs roll starting values', async () => {
  const lucien = new Actor({ id: 'lucien', name: 'Lucien', type: 'vampire', pc: false });
  actors.push(lucien); collection.push(lucien);
  // pairs order: moth>enzo, moth>lucien, enzo>moth, enzo>lucien, lucien>moth, lucien>enzo
  diceQueue = [2, 6, 3, 8, 5, 1];
  await api.runVaulderie(['moth', 'enzo', 'lucien']);
  assert.equal(r('moth', 'enzo'), 3);   // 2 holds at 3
  assert.equal(r('moth', 'lucien'), 6); // new
  assert.equal(r('lucien', 'enzo'), 1); // new, rolled 1
  assert.equal(r('enzo', 'lucien'), 8);
});

test('temporary modifier lowers effective rating only', async () => {
  await api.addModifier(['moth'], { target: 'all', delta: -3, label: 'Dissociate', hours: 1 });
  assert.equal(api.effective(collection.get('moth'), 'lucien'), 3);
  assert.equal(r('moth', 'lucien'), 6);
  game.time.worldTime = 7200;
  assert.equal(api.effective(collection.get('moth'), 'lucien'), 6);
});

test('conflict roll: favored at 5, others at 7, most successes wins', async () => {
  // moth effective: enzo 3, lucien 6
  diceQueue = [6, 6, 2, /* lucien */ 7, 8, 1, 3, 2, 2];
  const out = await api.conflictRoll(collection.get('moth'), ['enzo', 'lucien'], 'enzo');
  assert.equal(out.entries[0].net, 2); // 6,6 >= 5
  assert.equal(out.entries[1].net, 1); // 7,8 >= 7 minus one 1
  assert.deepEqual(out.winners, ['enzo']);
});
