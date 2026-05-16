import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const _meta = pgTable("_meta", {
  key: text("key").primaryKey().notNull(),
  value: jsonb("value").notNull().default(sql`'{}'::jsonb`),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type MetaRow = typeof _meta.$inferSelect;
export type MetaInsert = typeof _meta.$inferInsert;
