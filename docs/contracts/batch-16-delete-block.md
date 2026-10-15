# Batch 16: delete and block learned data

Approved by the user 2026-10-15 ("lets go with your recommended and build it, then do everything to release this into
the next release"). User's words: "I want the ability to delete any learned value from the database. right now I have
an undo etc.. but I need a way to permanently remove data."; "I want to be able to delete data, and any thing that is
blocked permanalty needs to be put into a sperate list so I can go back and undo it if I need to."; "lets selected the
remainder as you recommend". Release: R1 1.0.4.

## Behaviour

1. **DELETE on every row** of Places (`other-matches.json`), Sites and Planets (`other-bodies.json`) on the LEARNED
   DATA tab. A confirm dialog: title "Delete permanently?", line "This can't be undone.", a preview of what goes (up to
   10 labels, then "and N more"), buttons **Delete**, **Delete and block**, **Cancel** (Esc = Cancel).
   - Place: the entry is removed AND every change in RECENT CHANGES with that key (so UNDO can't restore it).
   - Site: the learned site (name near place) is removed.
   - Planet: the learned panel radius is removed (`radiusM`, its `seen`/`lastSeen` reset); the planet falls back to the
     estimate. The roster body itself stays (it is not learned data).
   - FORGET / UNDO on Places stay as they are.
2. **Delete and block**: the same delete, plus a BlockedItem per key in the BLOCKED list. While blocked:
   - Place: `recordSeen` / `recordProof` ignore the key (the game never learns it). A user CHANGE (set) still works.
   - Site: `recordLearnedPlace` ignores it.
   - Planet: the panel radius is not recorded for that body (estimate used).
3. **DELETE SHOWN** on each list (deletes every row the current filter/search shows) and **tick boxes** with
   **DELETE SELECTED** (suggestion 4). Both use the same confirm with the count ("Delete 37 entries permanently?").
4. **BLOCKED list**: a new section on LEARNED DATA (after Planets): label, list it came from (Places / Sites /
   Planets), blocked at; **UNBLOCK** per row (and tick boxes + UNBLOCK SELECTED). Unblocking does not bring data back;
   it can be learned again.
5. **Fix panel** (MatchFix, opened from the match tag on overlay / Next / Jobs; suggestion 2): a **Delete and block**
   button for the stop's text (kind place, its memory key), same confirm.
6. **Blocked tag** (suggestion 3): where a blocked place text shows (match tag area / Needs your eye), a grey
   `blocked` tag; clicking it opens LEARNED DATA scrolled to the BLOCKED list.
7. **Logs and diagnostics**: each delete / block / unblock logged (`learned data delete` { kind, count, block },
   `learned data unblock` { kind, count }; no entry contents). Diagnostics export gets `## BLOCKED` (count per kind and
   the items; the export sanitiser runs as for other sections).

## Shared contract (lead added)

- `src/other/otherBlocked.ts`: `LearnedKind`, `BlockedItem { kind, key, label, at }`, `BlockedDoc { items }`,
  `DeleteRequest { kind, keys, block }`, `DeleteReply { ok, deleted, blocked, error? }`. Owner of further pure helpers
  (normalize, add, remove, isBlocked): agent blocked.
- IPC (`src/shared/channels.ts`, preload): `otherDataDelete` ('otherData:delete', DeleteRequest -> DeleteReply),
  `otherBlockedGet` (-> BlockedDoc), `otherBlockedUnblock` ({kind,key}[] -> BlockedDoc), `evtOtherBlocked` (broadcast).
  Preload: `otherDataDelete(r)`, `otherBlockedGet()`, `otherBlockedUnblock(items)`, `onOtherBlocked(cb)`.
- Keys: place = `memoryKey(text, context)` (MemoryEntry.key); site = `${bodyKey(name)}|${bodyKey(near)}`
  (otherBodies `learnedKey`, export it); planet = `bodyKey(name)`.

## Owners

| Agent | Files | Job |
|---|---|---|
| memory | src/other/otherMemory.ts, src/other/main/matchMemory.ts, test/replay/memory_checks.mjs | pure `deleteEntries(doc, keys)` (entries + their changes); main `memoryDelete(keys)` (save, broadcast evtOtherMemory, return count); `memorySeen`/`memoryProof` skip blocked keys via an injected `isBlocked(kind,key)` from blocked.ts |
| bodies | src/other/otherBodies.ts, src/other/main/bodies.ts, test/replay/bodies_checks.mjs | export `learnedKey`; pure `deleteLearned(doc, keys)`, `deletePanelRadius(doc, keys)`; main `bodiesDelete(kind, keys)` (save, broadcast); `recordLearnedPlace` and the panel-radius record skip blocked keys |
| blocked | src/other/otherBlocked.ts (helpers), src/other/main/blocked.ts (new), src/other/main/register.ts (register IPC + `## BLOCKED` diag section), test/replay/blocked_checks.mjs (new) | load/save `other-blocked.json` via `src/main/paths.ts` data-folder helper (find the one matchMemory uses), `isBlocked(kind,key)`, IPC handlers: delete (calls memoryDelete / bodiesDelete, then adds blocks), get, unblock; broadcast evtOtherBlocked; logs |
| page | src/other/renderer/pages/LearnedDataPage.tsx, src/other/renderer/components/LearnedPlaces.tsx, LearnedBodies.tsx, new DeleteConfirm.tsx, new BlockedList.tsx, new src/other/renderer/state/otherBlockedStore.ts | rows' DELETE, tick boxes, DELETE SELECTED / DELETE SHOWN, confirm dialog, BLOCKED list with UNBLOCK |
| fix | src/other/renderer/components/MatchFix.tsx, MatchTag.tsx, NeedsYourEye.tsx, src/other/renderer/state/learnedFocus.ts | Delete and block in the fix panel (uses DeleteConfirm from page agent: import by name, wait for the file); blocked tag + open LEARNED DATA at BLOCKED |
| e2e | test/replay/replay.mjs | scenario: delete a place (gone from file + RECENT CHANGES), delete-and-block, the game sees the text again -> not learned, BLOCKED list shows it, UNBLOCK, restart keeps state; site + planet delete; DELETE SHOWN |
| docs | STANDALONE (new rules after 80; re-tie points for channels/preload), DECISIONS, SYSTEM-MAP, TODO, release-notes/1.0.4.md (public wording rule) | |

Release notes line (public): "Learned Data: delete entries permanently, or delete and block them so they are not
learned again. Blocked items are listed and can be unblocked."
