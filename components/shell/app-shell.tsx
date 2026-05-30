import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { member as memberTable, member_context } from "@/lib/db/schema.generated";
import { resolveTheme } from "@/lib/theme/resolve";
import { BASE_TOKENS } from "@/lib/theme/tokens";
import { tokenSetToCssVars } from "@/lib/theme/css";
import { resolveOrgDisplayName } from "@/lib/org-profile/shared";
import { readOrgProfile } from "@/lib/org-profile/store";
import { TopBar } from "./top-bar";
import { CoPilotDock } from "./co-pilot-dock";
import type { BuiltInRole } from "@/lib/auth/users";

interface Props {
  children: React.ReactNode;
  actor: { userId: string; role: BuiltInRole | null; email?: string } | null;
  modelName?: string;
}

export async function AppShell({ children, actor, modelName }: Props): Promise<React.ReactElement> {
  if (!actor) {
    // Unauthenticated (signin/setup) — render bare, but still apply the base
    // palette so these pages match the app's dark-first skin (globals.css :root
    // is light; the dark theme lives only in the injected vars, not a .dark class).
    return (
      <div
        style={tokenSetToCssVars(BASE_TOKENS)}
        className="min-h-screen bg-background text-foreground"
      >
        {children}
      </div>
    );
  }

  const db = getDb();
  let memberName = actor.email ?? "Member";
  let role = "staff";
  let themePref: string | null = null;

  try {
    const rows = await db
      .select({ full_name: memberTable.full_name, tier_role: memberTable.tier_role })
      .from(memberTable)
      .where(eq(memberTable.id, actor.userId))
      .limit(1);
    if (rows.length > 0) {
      memberName = rows[0].full_name;
      role = rows[0].tier_role;
    }
    const ctx = await db
      .select({ theme_pref: member_context.theme_pref })
      .from(member_context)
      .where(eq(member_context.member_id, actor.userId))
      .limit(1);
    themePref = ctx[0]?.theme_pref ?? null;
  } catch {
    // tolerate — fall back to base theme + defaults
  }

  const tokens = resolveTheme({ memberPref: themePref, role, orgSeed: null });
  const orgName = resolveOrgDisplayName(await readOrgProfile());

  return (
    <div
      id="app-shell-root"
      style={tokenSetToCssVars(tokens)}
      className="flex flex-col h-screen overflow-hidden bg-background text-foreground"
    >
      <TopBar memberName={memberName} role={role} orgName={orgName} />
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto">{children}</main>
        <CoPilotDock actorRole={actor.role} actorEmail={actor.email} modelName={modelName} />
      </div>
    </div>
  );
}
