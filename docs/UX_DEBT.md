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

## 4. /organize renders ALL unclassified rows — no LIMIT/pagination (crashes at scale)
`app/organize/page.tsx` runs `db.select().from(raw_inbox).where(isNull(classified_as))` with **no LIMIT**, then passes every row to `GrowPanel` + `ProposalReviewList` on the client. Bulk-ingesting ~20k CSV rows and opening `/organize` **crashed the browser renderer** (tab went unresponsive — screenshots and navigation timed out; required a manual reload). Note the ingest route itself (`/api/connect/csv`) is fine and *guard-capped* (max 5000 rows / 5 MB per request, chunked 1000-row inserts → 413 beyond) — the cliff is purely the review UI. There is also **no bulk-classify** (rows are classified ~individually), so even a rendered 20k list would be unusable.
- **Fix:** add a server-side `LIMIT` + pagination/virtualization to `/organize`; compute the unclassified count with a `count(*)` query (not `rows.length`); and add a **batch/sample classify** (infer a schema from a sample of a source file, then apply to the whole batch) instead of per-row.

## Context
Surfaced while watching an empty ontology grow from pasted ecovillage data (Member → Volunteer → Booking → LandZone → Workday). Growth renders on the canvas; the chat rail is secondary but currently noisy. The canvas should be the focus; the chat shouldn't require scrolling to follow what happened.
