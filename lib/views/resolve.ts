// Select the approved views a viewer should see, fail-closed by read permission.
// Three scopes resolved in precedence order org → role → viewer (most general
// first). Every descriptor's bound type must pass canReadType (the SAME predicate
// the render fence uses) or it is dropped before it can reach render — a view
// composed over a type this viewer cannot read leaks nothing.
import type { CanReadType } from "@/lib/widgets/read-api";
import type { ApprovedViewsRegistry, ApprovedViewDescriptor } from "./registry";

export interface ViewViewer {
  id: string;
  role: string;
}

function descriptorType(d: ApprovedViewDescriptor): string | undefined {
  const c = d.config;
  if (c && typeof c === "object" && "type" in c) {
    const t = (c as { type?: unknown }).type;
    if (typeof t === "string") return t;
  }
  return undefined;
}

export async function resolveApprovedViews(
  registry: ApprovedViewsRegistry,
  viewer: ViewViewer,
  canReadType: CanReadType,
): Promise<ApprovedViewDescriptor[]> {
  const rows = [
    ...(await registry.get({ scope: "org", scope_key: "" })),
    ...(await registry.get({ scope: "role", scope_key: viewer.role })),
    ...(await registry.get({ scope: "viewer", scope_key: viewer.id })),
  ];
  return rows.filter((d) => {
    const t = descriptorType(d);
    // a descriptor with no bound type cannot be permission-checked → drop (fail-closed)
    if (!t) return false;
    return canReadType(t);
  });
}
