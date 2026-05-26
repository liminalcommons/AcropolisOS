// Static function-backed action registry.
//
// Function-backed actions live in `functions/<functionName>.ts` as
// `export default defineAction({ schema, handler })` modules. The loader
// (function-backed.ts) historically resolved the file path at runtime and did
// a fully dynamic `import(fileUrl)`. Under the Next.js / Turbopack SERVER
// runtime that throws "Cannot find module as expression is too dynamic" —
// Turbopack cannot bundle a runtime-computed import specifier. (Vitest/Node
// resolve it fine, which is why unit tests passed while the deployed app's
// every function-backed action — dismiss_blocker, check_in, check_out, the
// resolve_blocker_* family, change_tier, flag_blocker, mark_notification_read,
// promote_to_steward — was non-functional.)
//
// This registry holds STATIC default-imports of every function descriptor so
// the common path is Turbopack-bundlable. Keys are the kebab `functionName`
// (the value of the `function:` field in ontology/action-types/*.yaml). Values
// are kept `unknown` so the loader's runtime `isActionDescriptor` check
// validates shape rather than fighting each descriptor's generic types.
//
// NOTE: `claim-shift` is declared in the ontology but has no
// `functions/claim-shift.ts` file — it is intentionally absent here; the
// loader's dynamic fallback reports file-not-found as before.

import changeTier from "@/functions/change-tier";
import checkIn from "@/functions/check-in";
import checkOut from "@/functions/check-out";
import dismissBlocker from "@/functions/dismiss-blocker";
import flagBlocker from "@/functions/flag-blocker";
import markNotificationRead from "@/functions/mark-notification-read";
import promoteToSteward from "@/functions/promote-to-steward";
import resolveBlockerWithCustom from "@/functions/resolve-blocker-with-custom";
import resolveBlockerWithInput from "@/functions/resolve-blocker-with-input";
import resolveBlockerWithPathway from "@/functions/resolve-blocker-with-pathway";

export const FUNCTION_REGISTRY: Record<string, unknown> = {
  "change-tier": changeTier,
  "check-in": checkIn,
  "check-out": checkOut,
  "dismiss-blocker": dismissBlocker,
  "flag-blocker": flagBlocker,
  "mark-notification-read": markNotificationRead,
  "promote-to-steward": promoteToSteward,
  "resolve-blocker-with-custom": resolveBlockerWithCustom,
  "resolve-blocker-with-input": resolveBlockerWithInput,
  "resolve-blocker-with-pathway": resolveBlockerWithPathway,
};
