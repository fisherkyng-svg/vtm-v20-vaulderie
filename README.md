# VtM V20 Vaulderie & Vinculum

Foundry VTT (v13–v14) module for the `vtm-v20` system. Tracks Vinculum and runs the Vaulderie by the V20 rules.

## Install

Manifest URL:

```
https://github.com/fisherkyng-svg/vtm-v20-vaulderie/releases/latest/download/module.json
```

## Rules implemented

- **No Vinculum yet** (first Vaulderie, or a new member joins): roll a d10 for each vampire whose vitae is in the chalice. The roll is the starting rating.
- **Existing Vinculum:** each Vaulderie, roll a d10 per Vinculum. Higher than the rating: +1 (max 10). A 1: −1 (min 1). Otherwise unchanged.
- **Vinculi do not fade over time.**
- **Conflict:** roll dice equal to the Vinculum toward each party, difficulty 5 for the party favored regardless of Vinculum, 7 for the rest. Most successes (1s cancel) wins.
- Vinculum is one-directional: Moth → Enzo is separate from Enzo → Moth.
- Only `vampire` actors take part. Ghouls and mortals are never listed.
- No blood is deducted: participants drink back what they put in.

## Use

**Storyteller** (Actors sidebar header):
- **Vaulderie**: tick participants (PCs and NPCs; selected tokens are pre-ticked), optional Priest, roll. One chat card shows each change. Whispered to the GM unless *Show results to everyone* is on.
- **Vinculum**: the matrix. Rows rate columns. Edit any cell (blank = none), add temporary modifiers (e.g. Dissociate −3 toward everyone), remove modifiers, open History.
- **History**: every Vaulderie and manual edit, with undo (undo newest first).

**Players:** a **Vinculum** tab on the character sheet (after Bio) lists their own ratings with dots, the last Vaulderie date, and a **Conflict roll** button. It appears once the character has any Vinculum. The Storyteller always sees it, plus a Matrix button.

## API

```js
const api = game.modules.get('vtm-v20-vaulderie').api;
api.openVaulderie();                       // dialog
await api.runVaulderie([id1, id2, id3]);   // direct
api.openMatrix();
api.rating(actor, targetId);               // base rating or null
api.effective(actor, targetId);            // after temporary modifiers
await api.addModifier([actorId], { target: 'all', delta: -3, label: 'Dissociate', hours: 24 });
await api.conflictRoll(actor, [partyA, partyB], favoredId);
```

## Notes

- Ratings are stored on the world actor. Unlinked NPC tokens share their base actor's Vinculum.
- Timed modifiers use Foundry's game clock. If you don't advance game time, leave the duration blank and remove the modifier from the matrix.

## Release

Bump `version` in `module.json` and push to `main`. The workflow runs tests, tags, and publishes.
