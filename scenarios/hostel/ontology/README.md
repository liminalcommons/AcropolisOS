# Seed: Hostel

Reference ontology for a small hostel (15–80 beds) that runs paid guests and work-exchange volunteers side-by-side. Modelled after a typical Worldpackers / Workaway-friendly backpackers' hostel.

## Object types

- **Member** — staff/manager. Distinct from Guest (transient) and WorkTrader (semi-transient).
- **Guest** — anyone staying at the hostel. May or may not have a `work_trade_agreement`. Includes `country`, `arrived_at`, `expected_departure`, `current_status` (booked / checked_in / checked_out / no_show).
- **Room** — physical room. `kind` is one of `dorm_mixed / dorm_female / dorm_male / private / staff`. Has `capacity`.
- **Bed** — a specific bed in a Room. Identified by code (e.g. "D3-A2" = Dorm 3, bed A2).
- **Booking** — Guest → Bed, with `from_date`, `to_date`, `rate_per_night`, `source` (direct / booking_com / hostelworld / work_trade).
- **Shift** — a scheduled work slot. `kind` is one of `reception / cleaning / kitchen / laundry / breakfast / night_audit`. Has `starts_at`, `duration_hours`, `claimed_by`.
- **WorkTradeAgreement** — Guest ↔ org agreement: `hours_per_week`, `bed_comp` (which Bed they hold), `start_date`, `end_date`.
- **Event** — movie night, walking tour, family dinner. Has `attendance_cap`.
- **IncidentLog** — noise complaint, damage, lost key, lockout, medical. Has `severity`.

## Link types

- **booked_into** — Guest → Bed (via Booking) — one-to-one at a given time
- **staffed** — Member|Guest → Shift — one-to-one (claimed)
- **attended** — Guest|Member → Event — many-to-many
- **involves** — IncidentLog → Guest|Member — many-to-many (who was involved)
- **trading_for** — WorkTradeAgreement → Bed — one-to-one (which bed they hold)

## Action types

- **check_in** — front-desk action; sets Guest.current_status='checked_in', creates an audit row.
- **check_out** — front-desk action; sets status='checked_out', frees Bed.
- **claim_shift** — Member or WorkTrader self-assigns to an open Shift.
- **log_incident** — anyone logs an incident; severity routing handled by function.
- **start_work_trade** — manager promotes a Guest to active WorkTradeAgreement.

## Roles

- **member** — base verified account
- **steward** — front-desk + supervisor (can check guests in/out, log incidents)
- **manager** — full write across the org (set rates, sign work-trade agreements)

`guest_self` permission token = the Guest row whose id matches the current actor (for work-traders who get login access).

## Why this ontology

Three shapes the propose pipeline must handle distinctly from permaculture:

1. **High-turnover transactional** — Booking, check_in/check_out (clean state transitions, double-booking prevention)
2. **Capacity-constrained scheduling** — Shift with `claimed_by`, Bed with current Booking. Tests whether action layer can enforce conflicts.
3. **Graduated role evolution** — Guest → WorkTrader → returning WorkTrader → staff Member. The classic chat-driven ontology evolution: "Anna's been here 6 weeks, can she help train new arrivals?" — should that introduce a new sub-role?

## Data

`data/` contains hand-seeded JSON for a representative week at Hostal Solana — paid guests, work-traders, shifts, one minor incident. Total ~70 rows.
