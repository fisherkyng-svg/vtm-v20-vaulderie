// VtM V20 Vaulderie & Vinculum — Foundry v13/v14 module.
import * as L from './logic.mjs';

const MOD = 'vtm-v20-vaulderie';
const SYSTEM_ID = 'vtm-v20';
const MAX_RUNS = 60;

const DialogV2 = () => foundry.applications.api.DialogV2;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isKindred = a => a?.type === 'vampire';
const worldActor = a => (a?.isToken ? game.actors.get(a.id) ?? a : a);
const nameOf = id => game.actors.get(id)?.name ?? 'Unknown vampire';
const now = () => game.time.worldTime;
const fmtDate = ts => (ts ? new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never');
const gmIds = () => game.users.filter(u => u.isGM).map(u => u.id);

// A null rating means "no Vinculum" (cleared). Avoids the '-=' deletion syntax, which v14 is phasing out.
const vinc = a => Object.fromEntries(Object.entries(a?.getFlag(MOD, 'vinculum') ?? {}).filter(([, v]) => v?.rating != null));
const modsOf = a => a?.getFlag(MOD, 'mods') ?? [];
const rating = (a, targetId) => vinc(a)[targetId]?.rating ?? null;
const effective = (a, targetId) => L.effective(rating(a, targetId), modsOf(a), targetId, now());

function requireGM() {
  if (game.user.isGM) return true;
  ui.notifications.warn('Only the Storyteller can do that.');
  return false;
}

// ---------------------------------------------------------------------------
// Persistence: ratings live on each rater's world actor; runs live in a world setting for undo.

async function applyChanges(changes, { lastVaulderie } = {}) {
  const byRater = new Map();
  for (const c of changes) {
    if (c.from === c.to) continue;
    const upd = byRater.get(c.rater) ?? {};
    upd[`flags.${MOD}.vinculum.${c.target}`] = { rating: c.to ?? null };
    byRater.set(c.rater, upd);
  }
  if (lastVaulderie) {
    for (const [id, ts] of Object.entries(lastVaulderie)) {
      const upd = byRater.get(id) ?? {};
      upd[`flags.${MOD}.lastVaulderie`] = ts;
      byRater.set(id, upd);
    }
  }
  for (const [id, upd] of byRater) await game.actors.get(id)?.update(upd);
}

const runs = () => foundry.utils.deepClone(game.settings.get(MOD, 'runs') ?? []);

async function saveRun(run) {
  const list = runs();
  list.unshift(run);
  await game.settings.set(MOD, 'runs', list.slice(0, MAX_RUNS));
}

async function undoRun(runId) {
  if (!requireGM()) return;
  const list = runs();
  const run = list.find(r => r.id === runId);
  if (!run || run.undone) return ui.notifications.warn('Nothing to undo for that entry.');
  const reversed = run.changes.map(c => ({ rater: c.rater, target: c.target, from: c.to, to: c.from }));
  await applyChanges(reversed, { lastVaulderie: run.prevLast ?? undefined });
  run.undone = true;
  run.undoneBy = game.user.name;
  await game.settings.set(MOD, 'runs', list);
  ui.notifications.info(`Undid: ${run.label}`);
}

// ---------------------------------------------------------------------------
// The Vaulderie

async function runVaulderie(actorIds, { priest = '', publicCard } = {}) {
  if (!requireGM()) return;
  const actors = [...new Set(actorIds)].map(id => worldActor(game.actors.get(id))).filter(isKindred);
  if (actors.length < 2) return ui.notifications.warn('The Vaulderie needs at least two Kindred.');
  const ids = actors.map(a => a.id);
  const pairList = L.pairs(ids);

  const roll = await new Roll(`${pairList.length}d10`).evaluate();
  const dice = roll.dice[0].results.map(r => r.result);
  const changes = pairList.map(([rater, target], i) => ({
    rater, target, die: dice[i], ...L.resolve(rating(game.actors.get(rater), target), dice[i]),
  }));

  const ts = Date.now();
  const prevLast = Object.fromEntries(actors.map(a => [a.id, a.getFlag(MOD, 'lastVaulderie') ?? null]));
  await applyChanges(changes, { lastVaulderie: Object.fromEntries(ids.map(id => [id, ts])) });
  await saveRun({
    id: foundry.utils.randomID(), ts, kind: 'vaulderie', user: game.user.name,
    label: `Vaulderie: ${actors.map(a => a.name).join(', ')}`, priest, changes, prevLast, undone: false,
  });

  const isPublic = publicCard ?? game.settings.get(MOD, 'publicResults');
  await ChatMessage.create({
    speaker: { alias: 'The Vaulderie' },
    content: vaulderieCard(actors, changes, priest),
    rolls: [roll],
    whisper: isPublic ? [] : gmIds(),
    sound: CONFIG.sounds?.dice,
  });
  return changes;
}

const KIND = {
  initial: ['vvd-new', 'new'],
  rise: ['vvd-up', '▲'],
  drop: ['vvd-down', '▼'],
  hold: ['vvd-hold', '—'],
};

function vaulderieCard(actors, changes, priest) {
  const rows = actors.map(a => {
    const lines = changes.filter(c => c.rater === a.id).map(c => {
      const [cls, mark] = KIND[c.kind];
      const val = c.kind === 'initial' ? `<b>${c.to}</b>` : (c.from === c.to ? `${c.to}` : `${c.from} → <b>${c.to}</b>`);
      return `<li class="${cls}"><span>${esc(nameOf(c.target))}</span><span>${val} <i>${mark}</i> <span class="vvd-die">(rolled ${c.die})</span></span></li>`;
    }).join('');
    return `<div class="vvd-rater"><h4>${esc(a.name)}</h4><ul>${lines}</ul></div>`;
  }).join('');
  return `<div class="vvd-card">
    <p class="vvd-lead">${priest ? `${esc(priest)} consecrates the chalice. ` : ''}${actors.length} Kindred share the Vaulderie.</p>
    ${rows}</div>`;
}

async function openVaulderie() {
  if (!requireGM()) return;
  const controlled = canvas?.tokens?.controlled?.map(t => worldActor(t.actor)).filter(isKindred).map(a => a.id) ?? [];
  const pool = game.actors.filter(a => isKindred(a) && (a.hasPlayerOwner || Object.keys(vinc(a)).length || controlled.includes(a.id)));
  const others = game.actors.filter(a => isKindred(a) && !pool.includes(a));
  const pre = controlled.length ? controlled : pool.filter(a => a.hasPlayerOwner).map(a => a.id);
  const box = a => `<label class="vvd-check"><input type="checkbox" name="actor" value="${a.id}" ${pre.includes(a.id) ? 'checked' : ''}>
    ${esc(a.name)} <span class="vvd-sub">${a.hasPlayerOwner ? 'PC' : 'NPC'} · last ${fmtDate(a.getFlag(MOD, 'lastVaulderie'))}</span></label>`;
  const content = `<div class="vvd-form">
    <fieldset><legend>Participants</legend>${pool.map(box).join('') || '<p class="vvd-sub">No Kindred found.</p>'}
      ${others.length ? `<details><summary>Other vampires (${others.length})</summary>${others.map(box).join('')}</details>` : ''}
    </fieldset>
    <label>Priest <span class="vvd-sub">(optional, for the chat card)</span><input type="text" name="priest"></label>
    <label class="vvd-check"><input type="checkbox" name="public" ${game.settings.get(MOD, 'publicResults') ? 'checked' : ''}> Show results to everyone</label>
    <p class="vvd-sub">New pairs roll a starting Vinculum. Existing ones rise on a die above the rating and drop on a 1. Ghouls and mortals are never listed.</p>
  </div>`;
  const res = await DialogV2().wait({
    window: { title: 'Perform the Vaulderie' }, content, rejectClose: false, position: { width: 460 },
    buttons: [
      { action: 'go', label: 'Drink', icon: 'fas fa-wine-glass', default: true,
        callback: (ev, btn) => ({
          ids: [...btn.form.querySelectorAll('input[name="actor"]:checked')].map(i => i.value),
          priest: btn.form.elements.priest.value.trim(),
          publicCard: btn.form.elements.public.checked,
        }) },
      { action: 'cancel', label: 'Cancel' },
    ],
  });
  if (!res || typeof res !== 'object') return;
  return runVaulderie(res.ids, res);
}

// ---------------------------------------------------------------------------
// Vinculum Matrix (GM): manual ratings and temporary modifiers

function matrixActors() {
  const ids = new Set();
  for (const a of game.actors) {
    if (!isKindred(a)) continue;
    const v = Object.keys(vinc(a));
    if (a.hasPlayerOwner || v.length) ids.add(a.id);
    v.forEach(t => game.actors.get(t) && ids.add(t));
  }
  return [...ids].map(id => game.actors.get(id)).filter(isKindred)
    .sort((a, b) => (b.hasPlayerOwner - a.hasPlayerOwner) || a.name.localeCompare(b.name));
}

async function openMatrix() {
  if (!requireGM()) return;
  for (;;) {
    const actors = matrixActors();
    if (actors.length < 2) return ui.notifications.warn('Need at least two Kindred (player-owned or with a Vinculum).');
    const head = actors.map(t => `<th title="${esc(t.name)}">${esc(t.name.split(' ')[0])}</th>`).join('');
    const body = actors.map(r => `<tr><th>${esc(r.name)}</th>${actors.map(t => {
      if (r.id === t.id) return '<td class="vvd-self">·</td>';
      const v = rating(r, t.id), e = effective(r, t.id);
      const eff = v != null && e !== v ? `<span class="vvd-eff" title="With temporary modifiers">${e}</span>` : '';
      return `<td><input type="number" min="1" max="10" name="${r.id}|${t.id}" value="${v ?? ''}">${eff}</td>`;
    }).join('')}</tr>`).join('');
    const modRows = actors.flatMap(a => modsOf(a).map(m => {
      const expired = m.until != null && now() >= m.until;
      return `<label class="vvd-check ${expired ? 'vvd-expired' : ''}"><input type="checkbox" name="rmmod" value="${a.id}|${m.id}">
        Remove: ${esc(a.name)} → ${m.target === 'all' ? 'all' : esc(nameOf(m.target))} ${m.delta > 0 ? '+' : ''}${m.delta}
        ${m.label ? `(${esc(m.label)})` : ''} <span class="vvd-sub">${m.until == null ? 'until removed' : expired ? 'expired' : 'timed'}</span></label>`;
    })).join('');
    const content = `<div class="vvd-form">
      <p class="vvd-sub">Rows rate columns. Blank means no Vinculum. Small red numbers show the rating after temporary modifiers.</p>
      <div class="vvd-matrix-wrap"><table class="vvd-matrix"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>
      ${modRows ? `<fieldset><legend>Temporary modifiers</legend>${modRows}</fieldset>` : ''}
    </div>`;
    const res = await DialogV2().wait({
      window: { title: 'Vinculum Matrix', resizable: true }, content, rejectClose: false,
      position: { width: Math.min(1100, 220 + 76 * actors.length) },
      buttons: [
        { action: 'save', label: 'Save', icon: 'fas fa-save', default: true,
          callback: (ev, btn) => ({
            action: 'save',
            cells: [...btn.form.querySelectorAll('input[type="number"]')].map(i => [i.name, i.value]),
            rm: [...btn.form.querySelectorAll('input[name="rmmod"]:checked')].map(i => i.value),
          }) },
        { action: 'mod', label: 'Add modifier', icon: 'fas fa-minus-circle', callback: () => ({ action: 'mod' }) },
        { action: 'history', label: 'History', icon: 'fas fa-history', callback: () => ({ action: 'history' }) },
        { action: 'close', label: 'Close' },
      ],
    });
    if (!res || typeof res !== 'object') return;
    if (res.action === 'mod') { await openAddModifier(actors); continue; }
    if (res.action === 'history') { await openHistory(); continue; }
    if (res.action === 'save') { await saveMatrix(res.cells, res.rm); return; }
    return;
  }
}

async function saveMatrix(cells, rm) {
  const changes = [];
  const bad = [];
  for (const [key, raw] of cells) {
    const [rater, target] = key.split('|');
    const to = L.parseRating(raw);
    if (to === undefined) { bad.push(`${nameOf(rater)} → ${nameOf(target)}`); continue; }
    const from = rating(game.actors.get(rater), target);
    if (from !== to) changes.push({ rater, target, from, to, kind: 'manual' });
  }
  if (bad.length) ui.notifications.warn(`Ignored values outside 1-10: ${bad.join(', ')}`);
  if (changes.length) {
    await applyChanges(changes);
    await saveRun({ id: foundry.utils.randomID(), ts: Date.now(), kind: 'manual', user: game.user.name,
      label: `Manual edit (${changes.length} rating${changes.length > 1 ? 's' : ''})`, changes, prevLast: null, undone: false });
  }
  const byActor = new Map();
  for (const v of rm) { const [a, m] = v.split('|'); byActor.set(a, [...(byActor.get(a) ?? []), m]); }
  for (const [id, mids] of byActor) {
    const a = game.actors.get(id);
    await a?.setFlag(MOD, 'mods', modsOf(a).filter(m => !mids.includes(m.id)));
  }
  if (changes.length || rm.length) ui.notifications.info(`Vinculum saved: ${changes.length} rating change(s), ${rm.length} modifier(s) removed.`);
}

async function addModifier(raterIds, { target = 'all', delta = -3, label = '', hours = null } = {}) {
  if (!requireGM()) return;
  const until = hours ? now() + Number(hours) * 3600 : null;
  for (const id of raterIds) {
    const a = game.actors.get(id);
    if (!isKindred(a)) continue;
    await a.setFlag(MOD, 'mods', [...modsOf(a), { id: foundry.utils.randomID(), target, delta: Number(delta), label, until }]);
  }
}

async function openAddModifier(actors) {
  const content = `<div class="vvd-form">
    <fieldset><legend>Whose Vinculum</legend>${actors.map(a =>
      `<label class="vvd-check"><input type="checkbox" name="rater" value="${a.id}"> ${esc(a.name)}</label>`).join('')}</fieldset>
    <label>Toward <select name="target"><option value="all">Everyone</option>${actors.map(a =>
      `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></label>
    <label>Change <input type="number" name="delta" value="-3" step="1"></label>
    <label>Reason <input type="text" name="label" value="Dissociate"></label>
    <label>Lasts (game hours) <input type="number" name="hours" min="0" step="1" placeholder="Blank = until removed"></label>
    <p class="vvd-sub">Timed modifiers expire with Foundry's game clock. If you don't advance game time, leave it blank and remove it in the matrix.</p>
  </div>`;
  const res = await DialogV2().wait({
    window: { title: 'Temporary Vinculum modifier' }, content, rejectClose: false,
    buttons: [
      { action: 'add', label: 'Add', default: true, callback: (ev, btn) => ({
        ids: [...btn.form.querySelectorAll('input[name="rater"]:checked')].map(i => i.value),
        target: btn.form.elements.target.value, delta: btn.form.elements.delta.value,
        label: btn.form.elements.label.value.trim(), hours: btn.form.elements.hours.value || null,
      }) },
      { action: 'cancel', label: 'Cancel' },
    ],
  });
  if (!res || typeof res !== 'object' || !res.ids.length) return;
  await addModifier(res.ids, res);
}

async function openHistory() {
  if (!requireGM()) return;
  const list = runs();
  if (!list.length) return ui.notifications.info('No Vaulderie history yet.');
  const row = r => `<tr class="${r.undone ? 'vvd-undone' : ''}"><td>${fmtDate(r.ts)}</td><td>${esc(r.user)}</td>
    <td>${esc(r.label)}${r.undone ? ` <span class="vvd-sub">(undone by ${esc(r.undoneBy)})</span>` : ''}</td>
    <td class="vvd-num">${r.changes.filter(c => c.from !== c.to).length}</td></tr>`;
  const undoable = list.filter(r => !r.undone);
  const content = `<div class="vvd-form">
    <table class="vvd-history"><thead><tr><th>When</th><th>By</th><th>What</th><th>Changed</th></tr></thead>
      <tbody>${list.map(row).join('')}</tbody></table>
    ${undoable.length ? `<label>Undo <select name="run">${undoable.map(r =>
      `<option value="${r.id}">${fmtDate(r.ts)} · ${esc(r.label)}</option>`).join('')}</select></label>
      <p class="vvd-sub">Undo restores each rating to what it was before that entry, so undo newest first.</p>` : ''}
  </div>`;
  const res = await DialogV2().wait({
    window: { title: 'Vinculum history' }, content, rejectClose: false, position: { width: 640 },
    buttons: [
      ...(undoable.length ? [{ action: 'undo', label: 'Undo selected', icon: 'fas fa-undo',
        callback: (ev, btn) => btn.form.elements.run.value }] : []),
      { action: 'close', label: 'Close', default: true },
    ],
  });
  if (typeof res === 'string' && res !== 'close') await undoRun(res);
}

// ---------------------------------------------------------------------------
// Vinculum conflict roll (owner or GM)

async function conflictRoll(actor, partyIds, favoredId = null) {
  actor = worldActor(actor);
  if (!actor?.isOwner) return ui.notifications.warn('You can only roll for your own character.');
  const entries = [];
  const rolls = [];
  for (const id of partyIds) {
    const dice = effective(actor, id) ?? 0;
    const favored = id === favoredId;
    const difficulty = L.conflictDifficulty(favored);
    let results = [];
    if (dice > 0) {
      const r = await new Roll(`${dice}d10`).evaluate();
      rolls.push(r);
      results = r.dice[0].results.map(x => x.result);
    }
    entries.push({ id, dice, favored, difficulty, results, ...L.successes(results, difficulty) });
  }
  const out = L.conflictOutcome(entries);
  const line = e => `<li class="${out.winners.includes(e.id) ? 'vvd-up' : ''}"><span>${esc(nameOf(e.id))}${e.favored ? ' <i>(favored)</i>' : ''}</span>
    <span>${e.dice} dice @ ${e.difficulty}: <b>${e.net}</b> <span class="vvd-die">[${e.results.join(', ') || '—'}]</span></span></li>`;
  const verdict = !out.winners.length
    ? 'No pull wins out. The character acts on her own judgment.'
    : out.tie ? `Tie between ${out.winners.map(nameOf).map(esc).join(' and ')}. The Storyteller decides.`
      : `The blood sides with <b>${esc(nameOf(out.winners[0]))}</b>.`;
  const data = {
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="vvd-card"><p class="vvd-lead">${esc(actor.name)} is torn by the Vinculum.</p><ul>${entries.map(line).join('')}</ul><p>${verdict}</p></div>`,
    rolls, sound: CONFIG.sounds?.dice,
  };
  ChatMessage.applyRollMode(data, game.settings.get('core', 'rollMode'));
  await ChatMessage.create(data);
  return { entries, ...out };
}

async function openConflict(actor) {
  actor = worldActor(actor);
  if (!actor?.isOwner) return;
  const targets = Object.keys(vinc(actor)).filter(id => game.actors.get(id))
    .sort((a, b) => (effective(actor, b) ?? 0) - (effective(actor, a) ?? 0));
  if (targets.length < 1) return ui.notifications.warn(`${actor.name} has no Vinculum to roll.`);
  const content = `<div class="vvd-form">
    <p class="vvd-sub">Tick the vampires pulling at ${esc(actor.name)}. Mark the one she'd favor if the Vinculum didn't exist: that one rolls at difficulty 5, the rest at 7.</p>
    <table class="vvd-history"><thead><tr><th>Party</th><th>Vinculum</th><th>Involved</th><th>Favored</th></tr></thead><tbody>
    ${targets.map(id => `<tr><td>${esc(nameOf(id))}</td><td class="vvd-num">${effective(actor, id)}</td>
      <td><input type="checkbox" name="party" value="${id}"></td><td><input type="radio" name="favored" value="${id}"></td></tr>`).join('')}
    <tr><td colspan="3">None of them</td><td><input type="radio" name="favored" value="" checked></td></tr>
    </tbody></table></div>`;
  const res = await DialogV2().wait({
    window: { title: `Vinculum conflict: ${actor.name}` }, content, rejectClose: false, position: { width: 480 },
    buttons: [
      { action: 'roll', label: 'Roll', icon: 'fas fa-dice-d10', default: true, callback: (ev, btn) => ({
        ids: [...btn.form.querySelectorAll('input[name="party"]:checked')].map(i => i.value),
        favored: btn.form.querySelector('input[name="favored"]:checked')?.value || null,
      }) },
      { action: 'cancel', label: 'Cancel' },
    ],
  });
  if (!res || typeof res !== 'object') return;
  const ids = res.favored && !res.ids.includes(res.favored) ? [...res.ids, res.favored] : res.ids;
  if (ids.length < 2) return ui.notifications.warn('Pick at least two parties.');
  return conflictRoll(actor, ids, res.favored);
}

// ---------------------------------------------------------------------------
// UI hooks: Vinculum tab on the character sheet, Actors directory buttons

const TAB = 'vinculum';

/** Show one tab. Prefer the system's own switcher so its drawers and classes stay in sync. */
function activateTab(app, root, tabId) {
  app._tab = tabId;
  if (typeof app._syncTabs === 'function') return app._syncTabs();
  root.querySelectorAll('.sheet-tabs .item[data-tab]').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
  root.querySelectorAll('.sheet-body > .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
}

function onRenderSheet(app, element) {
  const actor = app.document;
  if (game.system.id !== SYSTEM_ID || !isKindred(actor)) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  const nav = root?.querySelector('.sheet-tabs');
  const body = root?.querySelector('.sheet-body');
  if (!nav || !body) return;
  nav.querySelector(`.item[data-tab="${TAB}"]`)?.remove();
  body.querySelector(`:scope > .tab[data-tab="${TAB}"]`)?.remove();
  const a = worldActor(actor);
  const ids = Object.keys(vinc(a)).filter(id => game.actors.get(id))
    .sort((x, y) => (rating(a, y) ?? 0) - (rating(a, x) ?? 0));
  if (!ids.length && !game.user.isGM) {
    if (app._tab === TAB) activateTab(app, root, 'status');
    return;
  }

  // Tab button, placed after the system's own tabs (before the money display)
  const item = document.createElement('a');
  item.className = 'item vvd-tab-item';
  item.dataset.tab = TAB;
  item.innerHTML = `<i class="fas fa-wine-glass"></i> Vinculum${ids.length ? ` <span class="vvd-count">${ids.length}</span>` : ''}`;
  item.addEventListener('click', ev => { ev.preventDefault(); activateTab(app, root, TAB); });
  nav.insertBefore(item, nav.querySelector('.money-section'));

  const sec = document.createElement('div');
  sec.className = `tab ${TAB} vvd-sheet`;
  sec.dataset.group = 'primary';
  sec.dataset.tab = TAB;
  const rows = ids.map(id => {
    const v = rating(a, id), e = effective(a, id);
    const dots = Array.from({ length: 10 }, (_, i) => `<span class="vvd-dot ${i < e ? 'on' : ''}"></span>`).join('');
    return `<li><span class="vvd-name">${esc(nameOf(id))}</span><span class="vvd-dots" title="${e}${e !== v ? ` (base ${v})` : ''}">${dots}</span><span class="vvd-num">${e}${e !== v ? `<sup>${v}</sup>` : ''}</span></li>`;
  }).join('');
  sec.innerHTML = `<div class="section-block">
    <h2>Vinculum</h2>
    ${rows ? `<ul>${rows}</ul>` : '<p class="vvd-sub">No Vinculum yet. The Storyteller runs the Vaulderie from the Actors sidebar.</p>'}
    <p class="vvd-sub">Last Vaulderie: ${fmtDate(a.getFlag(MOD, 'lastVaulderie'))}. Vinculi do not fade with time.</p>
    <div class="vvd-bar">
      ${a.isOwner && ids.length >= 2 ? '<button type="button" data-vvd="conflict"><i class="fas fa-balance-scale"></i> Conflict roll</button>' : ''}
      ${game.user.isGM ? '<button type="button" data-vvd="matrix"><i class="fas fa-th"></i> Matrix</button>' : ''}
    </div></div>`;
  sec.addEventListener('click', ev => {
    const b = ev.target.closest('button[data-vvd]');
    if (!b) return;
    ev.preventDefault(); ev.stopPropagation();
    if (b.dataset.vvd === 'conflict') openConflict(a);
    if (b.dataset.vvd === 'matrix') openMatrix();
  });
  body.append(sec);

  // The system's switcher only knows about tabs present before this hook ran, so a
  // re-render while on Vinculum would leave every panel hidden. Restore it here.
  if (app._tab === TAB) activateTab(app, root, TAB);
}

function onRenderDirectory(app, element) {
  if (!game.user.isGM || game.system.id !== SYSTEM_ID) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  const header = root?.querySelector('.header-actions');
  if (!header || header.querySelector('.vvd-dir')) return;
  const mk = (cls, icon, label, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `vvd-dir ${cls}`;
    b.innerHTML = `<i class="fas ${icon}"></i> ${label}`;
    b.addEventListener('click', ev => { ev.preventDefault(); fn(); });
    return b;
  };
  header.append(mk('vvd-dir-rite', 'fa-wine-glass', 'Vaulderie', openVaulderie), mk('vvd-dir-matrix', 'fa-th', 'Vinculum', openMatrix));
}

Hooks.once('init', () => {
  game.settings.register(MOD, 'runs', { scope: 'world', config: false, type: Array, default: [] });
  game.settings.register(MOD, 'publicResults', {
    name: 'Show Vaulderie results to everyone',
    hint: 'Off: the result card is whispered to the Storyteller and each player sees only their own ratings on their sheet.',
    scope: 'world', config: true, type: Boolean, default: false,
  });
  Hooks.on('renderActorSheetV2', onRenderSheet);
  Hooks.on('renderActorDirectory', onRenderDirectory);
  game.modules.get(MOD).api = {
    openVaulderie, runVaulderie, openMatrix, openHistory, undoRun,
    openConflict, conflictRoll, addModifier,
    rating: (actor, targetId) => rating(worldActor(actor), targetId),
    effective: (actor, targetId) => effective(worldActor(actor), targetId),
  };
});
