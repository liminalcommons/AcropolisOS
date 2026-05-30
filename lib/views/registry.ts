// The approved_views registry contract. A "view" is a list of widget
// DESCRIPTORS (config, not code) — the same { id, kind, config, title } shape
// the render path (per-user.ts runDescriptors / org page) consumes. Scoped by
// {org, role, viewer}. Populated ONLY via the proposal apply loop; read by render.
import type { CatalogKind } from "@/lib/widgets/catalog";

export type ViewScopeName = "org" | "role" | "viewer";

export interface ViewScope {
  scope: ViewScopeName;
  // "" for org; the role name for role; the member id for viewer.
  scope_key: string;
}

export interface ApprovedViewDescriptor {
  id: string;
  kind: CatalogKind;
  config: unknown;
  title?: string;
}

export function scopeRowKey(s: ViewScope): string {
  return `${s.scope}:${s.scope_key}`;
}

export interface ApprovedViewsRegistry {
  get(scope: ViewScope): Promise<ApprovedViewDescriptor[]>;
  upsert(
    scope: ViewScope,
    descriptors: ApprovedViewDescriptor[],
    createdBy: string,
  ): Promise<void>;
}

export class InMemoryApprovedViewsRegistry implements ApprovedViewsRegistry {
  private rows = new Map<string, ApprovedViewDescriptor[]>();

  async get(scope: ViewScope): Promise<ApprovedViewDescriptor[]> {
    return this.rows.get(scopeRowKey(scope)) ?? [];
  }

  async upsert(
    scope: ViewScope,
    descriptors: ApprovedViewDescriptor[],
    _createdBy: string,
  ): Promise<void> {
    this.rows.set(scopeRowKey(scope), structuredClone(descriptors));
  }
}
