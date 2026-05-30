// Drizzle-backed approved_views registry. One row per (scope, scope_key) via the
// unique constraint + onConflictDoUpdate (idempotent upsert). descriptors is the
// JSONB descriptor list. Read by render; written ONLY by applyProposal.
import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { approved_views } from "@/lib/db/schema";
import type {
  ApprovedViewsRegistry,
  ApprovedViewDescriptor,
  ViewScope,
} from "./registry";

export class PgApprovedViewsRegistry implements ApprovedViewsRegistry {
  constructor(private readonly db: Database) {}

  async get(scope: ViewScope): Promise<ApprovedViewDescriptor[]> {
    const rows = await this.db
      .select({ descriptors: approved_views.descriptors })
      .from(approved_views)
      .where(
        and(
          eq(approved_views.scope, scope.scope),
          eq(approved_views.scope_key, scope.scope_key),
        ),
      )
      .limit(1);
    if (rows.length === 0) return [];
    return (rows[0].descriptors as ApprovedViewDescriptor[]) ?? [];
  }

  async upsert(
    scope: ViewScope,
    descriptors: ApprovedViewDescriptor[],
    createdBy: string,
  ): Promise<void> {
    await this.db
      .insert(approved_views)
      .values({
        scope: scope.scope,
        scope_key: scope.scope_key,
        descriptors,
        created_by: createdBy,
      })
      .onConflictDoUpdate({
        target: [approved_views.scope, approved_views.scope_key],
        set: { descriptors, updated_at: new Date() },
      });
  }
}
