# acropolisOS — UI / UX debt

Notes captured during the live ontology-growth demo on `/graph` (the canvas at `:3032`). User-reported, 2026-05-30.

## 1. Zoom controls clipped / not visible (bottom-left)
The React Flow zoom in/out (`+` / `−`) controls at the **bottom-left** of the `/graph` canvas are cut off or effectively invisible — the user reported they "can't see" them. Likely clipped by the viewport bottom edge, or overlapped by the minimap / the round "N" avatar bubble that also sits bottom-left.
- **Fix:** give the React Flow `<Controls>` bottom + left padding so it clears the viewport edge; ensure it renders **above** and **not under** the avatar/minimap; verify on shorter viewports (issue showed at ~726px height).

## 2. Chat side-rail forces scrolling up/down
The agent chat is a **narrow right-side rail**; the agent's verbose multi-paragraph replies force scrolling up and down to read, and the rail visually competes with the canvas where the actual growth happens.
- **Fix options:** (a) make agent replies **terser** (1–2 lines + a "details" expander); (b) a dedicated compact **"what just grew" feed** separate from the conversational chat; (c) auto-scroll to latest message + a "jump to newest" affordance; (d) allow the rail to widen/collapse.

## 3. Proposals can't be withdrawn / edited / rejected (lifecycle gap)
Once `finalize_proposal` runs, the pending proposal is **frozen** — there is no UI or agent tool to **edit, retract, or reject** it; the steward can only *apply* it. The agent itself surfaced this to the user ("once finalized it's locked; there's no tool to edit or retract it"). Consequence: a mistaken or messy proposal (e.g. a duplicate/poorly-named link) lingers in the pending set and on the `/graph` canvas with no clean removal short of a direct DB delete.
- **Fix:** add **withdraw/reject** (delete a pending proposal) and ideally **edit-before-apply** to `/graph` and the proposal-review UI. Let the agent re-issue a corrected proposal and discard the old one.

## Context
Surfaced while watching an empty ontology grow from pasted ecovillage data (Member → Volunteer → Booking → LandZone → Workday). Growth renders on the canvas; the chat rail is secondary but currently noisy. The canvas should be the focus; the chat shouldn't require scrolling to follow what happened.
