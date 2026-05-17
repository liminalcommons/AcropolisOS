// US-021: Refine codegen — YAML ontology to auto-CRUD Next.js routes.
//
// The codegen emits four Next.js App Router pages per object type:
//   app/(generated)/{Type}/page.tsx          — list view
//   app/(generated)/{Type}/[id]/page.tsx      — detail view
//   app/(generated)/{Type}/[id]/edit/page.tsx — edit view
//   app/(generated)/{Type}/new/page.tsx       — create view
//
// Pages use the Refine inferencer wired to a typed data provider backed by
// ctx (lib/ontology/ctx.ts). Custom views at `views/{Type}/{list|detail|edit}.tsx`
// shadow the generated pages — the page imports the override instead of
// instantiating the inferencer.

import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadOntology } from "../ontology/load";
import { generateRefineRoutes, type GeneratedFile } from "./refine";

const SEED_DIR = path.join(
  __dirname,
  "..",
  "..",
  "seed",
  "small-community",
  "ontology",
);

function findFile(files: GeneratedFile[], relPath: string): GeneratedFile {
  const normalized = relPath.replace(/\\/g, "/");
  const f = files.find((x) => x.path.replace(/\\/g, "/") === normalized);
  if (!f) {
    throw new Error(
      `expected generated file ${normalized}; got [\n${files.map((x) => "  " + x.path).join(",\n")}\n]`,
    );
  }
  return f;
}

describe("generateRefineRoutes — file layout", () => {
  it("emits list/detail/edit/create pages under app/(generated)/<Type>/ for every object type", async () => {
    const onto = await loadOntology(SEED_DIR);
    const files = generateRefineRoutes(onto);

    for (const type of ["Member", "Event", "MeetingMinute"]) {
      findFile(files, `app/(generated)/${type}/page.tsx`);
      findFile(files, `app/(generated)/${type}/[id]/page.tsx`);
      findFile(files, `app/(generated)/${type}/[id]/edit/page.tsx`);
      findFile(files, `app/(generated)/${type}/new/page.tsx`);
    }
  });

  it("marks every emitted file as generated", async () => {
    const onto = await loadOntology(SEED_DIR);
    const files = generateRefineRoutes(onto);
    for (const f of files) {
      expect(f.content, `header missing in ${f.path}`).toMatch(
        /THIS FILE IS GENERATED/,
      );
    }
  });

  it("emits client-component directive in every route file", async () => {
    const onto = await loadOntology(SEED_DIR);
    const files = generateRefineRoutes(onto);
    for (const f of files) {
      // Resource manifests aren't route files — skip the directive check.
      if (!f.path.endsWith("page.tsx")) continue;
      expect(f.content, `"use client" missing in ${f.path}`).toMatch(
        /^"use client";/m,
      );
    }
  });
});

describe("generateRefineRoutes — inferencer wiring", () => {
  it("list page uses the Refine list inferencer", async () => {
    const onto = await loadOntology(SEED_DIR);
    const files = generateRefineRoutes(onto);
    const f = findFile(files, "app/(generated)/Member/page.tsx");
    expect(f.content).toMatch(/from\s+"@refinedev\/inferencer\/[a-z-]+"/);
    expect(f.content).toMatch(/Inferencer/);
    // The resource name flows through so Refine knows which type to render.
    expect(f.content).toContain('resource="Member"');
  });

  it("detail page uses the Refine show inferencer", async () => {
    const onto = await loadOntology(SEED_DIR);
    const files = generateRefineRoutes(onto);
    const f = findFile(files, "app/(generated)/Event/[id]/page.tsx");
    expect(f.content).toMatch(/from\s+"@refinedev\/inferencer\/[a-z-]+"/);
    expect(f.content).toContain('resource="Event"');
    // The dynamic [id] segment is forwarded to the inferencer.
    expect(f.content).toMatch(/params/);
    expect(f.content).toMatch(/id\s*=\s*\{?id\}?|id=\{id\}/);
  });

  it("edit page uses the Refine edit inferencer with the route id", async () => {
    const onto = await loadOntology(SEED_DIR);
    const files = generateRefineRoutes(onto);
    const f = findFile(files, "app/(generated)/MeetingMinute/[id]/edit/page.tsx");
    expect(f.content).toMatch(/from\s+"@refinedev\/inferencer\/[a-z-]+"/);
    expect(f.content).toContain('resource="MeetingMinute"');
    expect(f.content).toMatch(/id\s*=\s*\{?id\}?/);
  });

  it("create page uses the Refine create inferencer", async () => {
    const onto = await loadOntology(SEED_DIR);
    const files = generateRefineRoutes(onto);
    const f = findFile(files, "app/(generated)/Member/new/page.tsx");
    expect(f.content).toMatch(/from\s+"@refinedev\/inferencer\/[a-z-]+"/);
    expect(f.content).toContain('resource="Member"');
  });
});

describe("generateRefineRoutes — typed data provider backed by ctx", () => {
  it("every page imports the ctx-backed data provider builder", async () => {
    const onto = await loadOntology(SEED_DIR);
    const files = generateRefineRoutes(onto);
    for (const f of files) {
      // Skip the layout file from this assertion if any sneaks in;
      // every PAGE file imports the data provider hook.
      if (!f.path.endsWith("page.tsx")) continue;
      expect(f.content, `data provider import missing in ${f.path}`).toMatch(
        /from\s+"@\/lib\/refine\/data-provider"/,
      );
      // The page either uses the provider directly or via a hook helper.
      expect(f.content).toMatch(
        /createOntologyDataProvider|useOntologyDataProvider/,
      );
    }
  });

  it("emits a Refine resources manifest referencing every object type", async () => {
    const onto = await loadOntology(SEED_DIR);
    const files = generateRefineRoutes(onto);
    // The codegen surfaces a resources manifest the layout can consume;
    // it lives alongside the routes.
    const manifest = findFile(files, "app/(generated)/resources.generated.ts");
    expect(manifest.content).toMatch(/THIS FILE IS GENERATED/);
    expect(manifest.content).toMatch(/export\s+const\s+generatedResources/);
    for (const type of ["Member", "Event", "MeetingMinute"]) {
      expect(manifest.content).toContain(`name: "${type}"`);
      expect(manifest.content).toContain(`list: "/${type}"`);
      expect(manifest.content).toContain(`show: "/${type}/:id"`);
      expect(manifest.content).toContain(`edit: "/${type}/:id/edit"`);
      expect(manifest.content).toContain(`create: "/${type}/new"`);
    }
  });
});

describe("generateRefineRoutes — create form surfaces add_X action params", () => {
  it("create page declares the matching add_<type> action parameter schema as form fields", async () => {
    const onto = await loadOntology(SEED_DIR);
    const files = generateRefineRoutes(onto);

    // Member -> add_member (full_name, email, tier)
    const memberNew = findFile(files, "app/(generated)/Member/new/page.tsx");
    expect(memberNew.content).toContain('actionName: "add_member"');
    expect(memberNew.content).toContain("full_name");
    expect(memberNew.content).toContain("email");
    expect(memberNew.content).toContain("tier");
    // Schema source is the generated zod module so types stay in sync.
    expect(memberNew.content).toMatch(
      /from\s+"@\/lib\/ontology\/types\.generated"/,
    );
    expect(memberNew.content).toContain("AddMemberParamsSchema");
  });

  it("MeetingMinute create page wires add_meeting_minute params", async () => {
    const onto = await loadOntology(SEED_DIR);
    const files = generateRefineRoutes(onto);
    const f = findFile(files, "app/(generated)/MeetingMinute/new/page.tsx");
    expect(f.content).toContain('actionName: "add_meeting_minute"');
    expect(f.content).toContain("AddMeetingMinuteParamsSchema");
    // The three declared params show up:
    expect(f.content).toContain("title");
    expect(f.content).toContain("body");
    expect(f.content).toContain("event");
  });

  it("falls back to the inferencer create when no add_<type> action exists", async () => {
    const onto = await loadOntology(SEED_DIR);
    // Drop every action to exercise the no-add branch.
    const stripped = { ...onto, action_types: {} };
    expect(() => generateRefineRoutes(stripped)).not.toThrow();
    const files = generateRefineRoutes(stripped);
    const f = findFile(files, "app/(generated)/Member/new/page.tsx");
    // Without a matching action, the page still renders via inferencer
    // but does NOT reference a *ParamsSchema.
    expect(f.content).not.toMatch(/AddMemberParamsSchema/);
    expect(f.content).toMatch(/Inferencer/);
  });
});

describe("generateRefineRoutes — custom view overrides", () => {
  it("when views/<Type>/list.tsx is declared, the list page imports it instead of the inferencer", async () => {
    const onto = await loadOntology(SEED_DIR);
    const files = generateRefineRoutes(onto, {
      customViews: { Member: ["list"] },
    });
    const f = findFile(files, "app/(generated)/Member/page.tsx");
    expect(f.content).toMatch(/from\s+"@\/views\/Member\/list"/);
    // Inferencer must NOT be imported when the override is in play.
    expect(f.content).not.toMatch(/@refinedev\/inferencer/);
  });

  it("custom detail.tsx shadows only the detail page", async () => {
    const onto = await loadOntology(SEED_DIR);
    const files = generateRefineRoutes(onto, {
      customViews: { Event: ["detail"] },
    });
    const detail = findFile(files, "app/(generated)/Event/[id]/page.tsx");
    expect(detail.content).toMatch(/from\s+"@\/views\/Event\/detail"/);
    expect(detail.content).not.toMatch(/@refinedev\/inferencer/);

    // list/edit/new for Event still use the inferencer.
    const list = findFile(files, "app/(generated)/Event/page.tsx");
    expect(list.content).toMatch(/@refinedev\/inferencer/);
    expect(list.content).not.toMatch(/from\s+"@\/views\/Event\/list"/);
  });

  it("custom edit.tsx shadows the edit page", async () => {
    const onto = await loadOntology(SEED_DIR);
    const files = generateRefineRoutes(onto, {
      customViews: { MeetingMinute: ["edit"] },
    });
    const f = findFile(files, "app/(generated)/MeetingMinute/[id]/edit/page.tsx");
    expect(f.content).toMatch(/from\s+"@\/views\/MeetingMinute\/edit"/);
    expect(f.content).not.toMatch(/@refinedev\/inferencer/);
  });

  it("custom-view override does not affect other object types", async () => {
    const onto = await loadOntology(SEED_DIR);
    const files = generateRefineRoutes(onto, {
      customViews: { Member: ["list", "detail", "edit"] },
    });
    // Other types still use the inferencer for all three views.
    for (const path of [
      "app/(generated)/Event/page.tsx",
      "app/(generated)/Event/[id]/page.tsx",
      "app/(generated)/Event/[id]/edit/page.tsx",
    ]) {
      expect(findFile(files, path).content).toMatch(/@refinedev\/inferencer/);
    }
  });
});

describe("generateRefineRoutes — stability", () => {
  it("produces byte-identical output across repeat invocations", async () => {
    const onto = await loadOntology(SEED_DIR);
    const a = generateRefineRoutes(onto);
    const b = generateRefineRoutes(onto);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].path).toBe(b[i].path);
      expect(a[i].content).toBe(b[i].content);
    }
  });
});
