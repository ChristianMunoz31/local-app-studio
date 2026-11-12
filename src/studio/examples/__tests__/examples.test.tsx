// The rules every example app must meet (phase 20 design, section 3): valid, small, opens clean, renders with its own
// sample records, and stays inside the size and text rules.
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SpecPage } from "@local-app-studio/runtime/runtime";
import { AppSpecSchema } from "@local-app-studio/runtime/spec/schema";
import type {
  AppSpec,
  LayoutLayer,
  Page,
  Table,
} from "@local-app-studio/runtime/spec/schema";
import {
  MENU_PARTS,
  MENU_ROW_PARTS,
  slotLayers,
} from "@local-app-studio/runtime/spec/menuSlots";
import { THEME_IDS } from "@local-app-studio/runtime/theme/ids";
import { THEMES } from "@local-app-studio/runtime/theme/themes";
import { validateAppSpec } from "@local-app-studio/runtime/spec/schema";
import { CATALOG_CHECKS } from "@/catalog/validateLayout";
import { connectionIssues } from "@/studio/design/connections";
import { specNeeds } from "@/studio/design/indicator";
import { PART_NAMES } from "@/catalog/definitions";
import { addsRecords } from "@/studio/lib/addsRecords";
import { checkSample, resolveRow } from "@/studio/lib/sampleData";
import type { SampleRecords, SampleRow } from "@/studio/lib/sampleData";
import { sampleDataSource } from "@/studio/lib/sampleDataSource";
import {
  loadHashedDenylist,
  loadDenylist,
  scanText,
} from "../../../../scripts/checks/personalData.js";
import { EXAMPLES, EXAMPLE_TIMEOUT_MS, loadExample } from "../index";
import type { ExampleBody, ExampleMeta } from "../index";

afterEach(cleanup);

// index.ts and the sixteen JSON files under public/examples/ (what the app fetches from its own origin).
const FILES = import.meta.glob(
  ["../index.ts", "../../../../public/examples/*.json"],
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;
const PUBLIC = "../../../../public";
const TODAY = new Date(2026, 5, 15, 12, 0, 0);
const SIZE_LIMIT = 14336;
// The small tables, chosen explicitly: lookup tables other tables point at that are not the focus of the app
// (3 to 8 rows). Every other table is a main table (8 to 20 rows).
const SMALL_TABLES = new Set([
  "appointments.clients",
  "crew-board.crews",
  "expense-log.categories",
  "invoices-and-clients.clients",
  "membership-attendance.sessions",
  "reading-list.shelves",
]);
// What the public build offers: the catalog parts (every pro part is off in it) and the public menu slot parts.
const PUBLIC_PARTS = new Set<string>(PART_NAMES);
const MENU_OK = new Set<string>(MENU_PARTS);
const MENU_ROW_OK = new Set<string>(MENU_ROW_PARTS);
const SHOWY_PARTS = ["Chart", "FilterBar", "Checklist", "ProgressBar"];
const DATA_PARTS = [
  "DataTable",
  "RecordList",
  "StatCard",
  "Chart",
  "ProgressBar",
  "Checklist",
  "Timeline",
];

const isToken = (v: unknown): v is { $days: number } =>
  typeof v === "object" && v !== null && "$days" in v;
const walk = (layers: LayoutLayer[], visit: (l: LayoutLayer) => void): void => {
  for (const l of layers) {
    visit(l);
    if (Array.isArray(l.children)) walk(l.children, visit);
  }
};
const menuLayers = (spec: AppSpec): LayoutLayer[] =>
  (["start", "end"] as const).flatMap(
    (s) => slotLayers(spec.menu, s) as LayoutLayer[],
  );
const allLayers = (spec: AppSpec): LayoutLayer[] => {
  const out: LayoutLayer[] = [];
  walk([...spec.pages.map((p) => p.layout), ...menuLayers(spec)], (l) =>
    out.push(l),
  );
  return out;
};
const read = (file: string): string =>
  (file === "index.ts" ? FILES["../index.ts"] : FILES[`${PUBLIC}/examples/${file}`]) ?? "";

// loadExample fetches same-origin URLs; answer them from the files in public/examples/ and 404 anything else.
const requested: string[] = [];
beforeAll(() => {
  vi.stubGlobal("fetch", async (url: string) => {
    requested.push(url);
    const text = FILES[`${PUBLIC}${url}`];
    return text === undefined
      ? new Response("not found", { status: 404 })
      : new Response(text, { status: 200 });
  });
});
afterAll(() => vi.unstubAllGlobals());

/** Gzip size in bytes (the same deflate stream a build sends). */
async function gzipLength(text: string): Promise<number> {
  const gzip = new CompressionStream("gzip");
  const writer = gzip.writable.getWriter();
  const done = writer
    .write(new TextEncoder().encode(text))
    .then(() => writer.close());
  const reader = gzip.readable.getReader();
  let size = 0;
  for (let r = await reader.read(); !r.done; r = await reader.read())
    size += r.value.byteLength;
  await done;
  return size;
}

// The check lives in plain JS; its option types are inferred too narrowly.
const scan = scanText as (
  text: string,
  options: { denylist: unknown; hashedDenylist: unknown },
) => unknown[];

interface Loaded {
  meta: ExampleMeta;
  body: ExampleBody;
  spec: AppSpec;
  records: SampleRecords;
  bytes: number;
}
const loaded: Loaded[] = [];

describe("example apps", () => {
  it("lists exactly eight examples with unique ids", async () => {
    expect(EXAMPLES).toHaveLength(8);
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(8);
    for (const meta of EXAMPLES) {
      const body = await loadExample(meta.id);
      const parsed = AppSpecSchema.safeParse(body.spec);
      expect(parsed.success, `${meta.id} parses`).toBe(true);
      if (!parsed.success) continue;
      loaded.push({
        meta,
        body,
        spec: parsed.data,
        records: body.records,
        bytes: await gzipLength(
          JSON.stringify(body.spec) + JSON.stringify(body.records),
        ),
      });
    }
    expect(loaded).toHaveLength(8);
  });

  describe("loadExample abort and timeout", () => {
    const answered = vi.fn();
    /** A fetch that never answers and rejects when its signal aborts. */
    const hanging = (url: string, init?: RequestInit): Promise<Response> => {
      answered(url, init);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    };
    let standard: typeof fetch = globalThis.fetch;
    // The file-wide beforeAll has stubbed fetch by now; keep that stub to put back after each test here.
    beforeAll(() => {
      standard = globalThis.fetch;
    });
    afterEach(() => {
      vi.restoreAllMocks();
      answered.mockReset();
      vi.stubGlobal("fetch", standard);
    });

    it("gives each fetch the 15 second timeout alone when no signal is passed", async () => {
      const timeout = new AbortController();
      const spy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
      vi.stubGlobal("fetch", hanging);
      const pending = loadExample("reading-list");
      timeout.abort();
      await expect(pending).rejects.toThrow("aborted");
      expect(EXAMPLE_TIMEOUT_MS).toBe(15_000);
      expect(spy).toHaveBeenCalledWith(15_000);
      expect(answered).toHaveBeenCalledTimes(2);
      for (const call of answered.mock.calls) expect((call[1] as RequestInit).signal).toBe(timeout.signal);
    });

    it("cancels both fetches when the caller aborts", async () => {
      vi.stubGlobal("fetch", hanging);
      const caller = new AbortController();
      const pending = loadExample("reading-list", caller.signal);
      for (const call of answered.mock.calls) expect((call[1] as RequestInit).signal?.aborted).toBe(false);
      caller.abort();
      await expect(pending).rejects.toThrow("aborted");
      expect(answered).toHaveBeenCalledTimes(2);
      for (const call of answered.mock.calls) expect((call[1] as RequestInit).signal?.aborted).toBe(true);
    });

    it("still stops on the timeout when a caller signal is passed", async () => {
      const timeout = new AbortController();
      vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
      vi.stubGlobal("fetch", hanging);
      const caller = new AbortController();
      const pending = loadExample("reading-list", caller.signal);
      timeout.abort();
      await expect(pending).rejects.toThrow("aborted");
      expect(caller.signal.aborted).toBe(false);
    });
  });

  it("index.ts has no static JSON import", () => {
    expect(read("index.ts").length).toBeGreaterThan(0);
    expect(read("index.ts")).not.toMatch(/^import\s[^;]*\.json/m);
  });

  it("has an index entry that matches each spec", () => {
    for (const { meta, spec } of loaded) {
      const mode =
        spec.theme.overrides?.mode ??
        (spec.theme.id ? THEMES[spec.theme.id].mode : "light");
      expect(meta.id, meta.id).toBe(spec.app.slug);
      expect(spec.app.identifier, meta.id).toBe(
        `com.example.${meta.id.replaceAll("-", "")}`,
      );
      expect(spec.app.version).toBe("1.0.0");
      expect(spec.app.icon, meta.id).not.toBeNull();
      expect(meta.name, meta.id).toBe(spec.app.name);
      expect(meta.description, meta.id).toBe(spec.app.description);
      expect(meta.tables, meta.id).toBe(spec.tables.length);
      expect(meta.pages, meta.id).toBe(spec.pages.length);
      expect(meta.theme, meta.id).toBe(spec.theme.id);
      expect(meta.mode, meta.id).toBe(mode);
    }
  });

  it("passes the schema and the catalog checks, with no issues", () => {
    for (const { body, meta } of loaded) {
      const result = validateAppSpec(body.spec, { ...CATALOG_CHECKS });
      expect(result.issues, meta.id).toEqual([]);
      expect(result.ok, meta.id).toBe(true);
    }
  });

  it("has 2 to 4 tables and pages, a menu bar, and at least two nav items with icons", () => {
    for (const { spec, meta } of loaded) {
      expect(spec.tables.length, meta.id).toBeGreaterThanOrEqual(2);
      expect(spec.tables.length, meta.id).toBeLessThanOrEqual(4);
      expect(spec.pages.length, meta.id).toBeGreaterThanOrEqual(2);
      expect(spec.pages.length, meta.id).toBeLessThanOrEqual(4);
      expect(spec.menu, meta.id).toBeDefined();
      expect(spec.nav.length, meta.id).toBeGreaterThanOrEqual(2);
      for (const n of spec.nav)
        expect(n.icon, `${meta.id} nav ${n.pageId}`).toBeDefined();
      const listed = spec.pages
        .filter((p) => !p.route.endsWith("/:id"))
        .map((p) => p.id);
      expect(spec.nav.map((n) => n.pageId).sort(), meta.id).toEqual(
        listed.sort(),
      );
    }
  });

  it("gives every table a way to add a record", () => {
    for (const { spec, meta } of loaded) {
      const layers = allLayers(spec);
      for (const t of spec.tables) {
        const adds = layers.some(
          (l) =>
            (l.type === "RecordForm" &&
              l.props.table === t.id &&
              l.props.mode !== "edit") ||
            (l.type === "QuickAdd" && l.props.table === t.id) ||
            (l.type === "Button" &&
              (
                l.props.action as
                  { action?: string; table?: string; mode?: string } | undefined
              )?.action === "open-form" &&
              (l.props.action as { table?: string }).table === t.id &&
              (l.props.action as { mode?: string }).mode !== "edit"),
        );
        expect(adds, `${meta.id} ${t.id}`).toBe(true);
      }
      expect(addsRecords(spec), meta.id).toBe(true);
    }
  });

  it("has a record page and a home page with a data part", () => {
    for (const { spec, meta } of loaded) {
      const recordPage = spec.pages.find(
        (p) =>
          p.route.endsWith("/:id") &&
          p.sources.some((s) => s.mode === "record"),
      );
      expect(recordPage, meta.id).toBeDefined();
      const home = spec.pages.find((p) => p.route === "/");
      const types: string[] = [];
      walk([home!.layout], (l) => types.push(l.type));
      expect(
        types.some((t) => DATA_PARTS.includes(t)),
        meta.id,
      ).toBe(true);
    }
  });

  it("has plain words: one sentence for it, three or four shows, two or three first edits", () => {
    for (const { meta, spec } of loaded) {
      expect(spec.app.description.length, meta.id).toBeGreaterThan(0);
      expect(spec.app.description.length, meta.id).toBeLessThanOrEqual(300);
      expect(spec.app.description, meta.id).toMatch(/^For [^.]+\.$/);
      expect(meta.shows.length, meta.id).toBeGreaterThanOrEqual(3);
      expect(meta.shows.length, meta.id).toBeLessThanOrEqual(4);
      for (const s of meta.shows)
        expect(s.length, `${meta.id} ${s}`).toBeLessThanOrEqual(40);
      expect(meta.tryThese.length, meta.id).toBeGreaterThanOrEqual(2);
      expect(meta.tryThese.length, meta.id).toBeLessThanOrEqual(3);
      for (const s of meta.tryThese)
        expect(s.length, `${meta.id} ${s}`).toBeLessThanOrEqual(60);
    }
  });

  it("has sample records that fit the spec, in the right amounts, with dates as tokens", () => {
    for (const { spec, records, meta } of loaded) {
      const checked = checkSample(records, spec);
      expect(checked.ok ? "" : checked.problem, meta.id).toBe("");
      let largest = 0;
      for (const t of spec.tables) {
        const rows = records.tables[t.id] ?? [];
        // Main tables hold 8 to 20 rows, the small lookup tables listed in SMALL_TABLES 3 to 8.
        const small = SMALL_TABLES.has(`${meta.id}.${t.id}`);
        expect(rows.length, `${meta.id} ${t.id} rows`).toBeGreaterThanOrEqual(
          small ? 3 : 8,
        );
        expect(rows.length, `${meta.id} ${t.id} rows`).toBeLessThanOrEqual(
          small ? 8 : 20,
        );
        largest = Math.max(largest, rows.length);
        for (const f of t.fields.filter(
          (x) => x.type === "date" || x.type === "datetime",
        )) {
          const offsets = rows
            .map((r) => r[f.id])
            .filter((v) => v !== undefined);
          for (const v of offsets)
            expect(isToken(v), `${meta.id} ${t.id}.${f.id} is a token`).toBe(
              true,
            );
          const max = Math.max(
            ...offsets.map((v) => (v as { $days: number }).$days),
          );
          if (offsets.length > 0)
            expect(
              max,
              `${meta.id} ${t.id}.${f.id} reaches this week`,
            ).toBeGreaterThanOrEqual(-7);
          if (f.type === "datetime")
            for (const v of offsets)
              expect(
                (v as { time?: string }).time,
                `${meta.id} ${t.id}.${f.id} time`,
              ).toMatch(/^\d\d:\d\d$/);
        }
      }
      expect(largest, `${meta.id} largest table`).toBeGreaterThanOrEqual(8);
      expect(Object.keys(records.tables).sort(), meta.id).toEqual(
        spec.tables.map((t) => t.id).sort(),
      );
    }
  });

  it("shows something to look at: a chart, a filter bar, a checklist, a progress bar or a menu slot", () => {
    for (const { spec, meta } of loaded) {
      const showy =
        allLayers(spec).some((l) => SHOWY_PARTS.includes(l.type)) ||
        menuLayers(spec).length > 0;
      expect(showy, meta.id).toBe(true);
    }
  });

  it("uses only parts and themes the public build has", () => {
    for (const { spec, meta } of loaded) {
      walk(
        spec.pages.map((p) => p.layout),
        (l) => expect(PUBLIC_PARTS.has(l.type), `${meta.id} ${l.type}`).toBe(true),
      );
      for (const slot of ["start", "end"] as const)
        for (const top of slotLayers(spec.menu, slot) as LayoutLayer[]) {
          expect(MENU_OK.has(top.type), `${meta.id} menu ${top.type}`).toBe(true);
          if (top.type === "Row")
            walk(top.children as LayoutLayer[], (l) =>
              expect(
                MENU_ROW_OK.has(l.type),
                `${meta.id} menu row ${l.type}`,
              ).toBe(true),
            );
        }
      expect(spec.theme.id, meta.id).toBeDefined();
      expect(THEME_IDS as readonly string[], meta.id).toContain(spec.theme.id);
    }
  });

  it("opens clean in Design: no unconnected part, no missing table or field", () => {
    for (const { spec, meta } of loaded) {
      expect(connectionIssues(spec, null), meta.id).toEqual([]);
      expect(specNeeds(spec), meta.id).toEqual([]);
    }
  });

  it("renders every page with its sample records and no error", async () => {
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    for (const { spec, records, meta } of loaded) {
      const ids = new Map<string, string>();
      const byTable: Record<string, SampleRow[]> = records.tables;
      for (const t of spec.tables)
        (byTable[t.id] ?? []).forEach((row, i) =>
          ids.set(
            `${t.id}:${String(row._id ?? `${t.id}-${i + 1}`)}`,
            String(row._id ?? `${t.id}-${i + 1}`),
          ),
        );
      const idOf = (table: string, key: string): string | undefined =>
        ids.get(`${table}:${key}`);
      const rows: Record<string, Record<string, unknown>[]> = {};
      for (const t of spec.tables as Table[]) {
        rows[t.id] = (byTable[t.id] ?? []).map((row, i) => ({
          id: String(row._id ?? `${t.id}-${i + 1}`),
          ...Object.fromEntries(
            t.fields.flatMap((f) =>
              "default" in f && f.default !== undefined
                ? [[f.id, f.default]]
                : [],
            ),
          ),
          ...resolveRow(t, row, TODAY, idOf),
        }));
      }
      const source = sampleDataSource(rows, spec);
      for (const page of spec.pages as Page[]) {
        const recordSource = page.sources.find((s) => s.mode === "record");
        const recordId = recordSource
          ? ((rows[recordSource.table][0]?.id as string | undefined) ?? null)
          : null;
        const view = render(
          <MemoryRouter>
            <SpecPage
              spec={spec}
              pageId={page.id}
              recordId={recordId}
              dataSource={source}
            />
          </MemoryRouter>,
        );
        await act(async () => {
          await new Promise((r) => setTimeout(r, 40));
        });
        const text = view.container.textContent ?? "";
        const where = `${meta.id} ${page.id}`;
        expect(text, where).not.toContain("This part could not be shown.");
        expect(text, where).not.toContain("This part is not available.");
        expect(text, where).not.toContain("This page is not part of the app.");
        expect(text.length, `${where} has content`).toBeGreaterThan(0);
        if (page.route === "/") {
          const tablesShown = new Set(page.sources.map((s) => s.table));
          const values = [...tablesShown].flatMap((t) =>
            (byTable[t] ?? []).flatMap((r) =>
              Object.values(r).filter(
                (v): v is string =>
                  typeof v === "string" &&
                  v.length > 2 &&
                  !ids.has(`${t}:${v}`),
              ),
            ),
          );
          // A home made only of totals and charts shows the stat label with its number instead of a record's text.
          const labels: string[] = [];
          walk([page.layout], (l) => {
            if (l.type === "StatCard" && typeof l.props.label === "string")
              labels.push(l.props.label);
          });
          const shown =
            values.some((v) => text.includes(v)) ||
            (labels.length > 0 &&
              labels.every((x) => text.includes(x)) &&
              /[0-9]/.test(text));
          expect(shown, `${where} shows a sample value`).toBe(true);
        }
        view.unmount();
      }
    }
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("keeps the set varied: distinct themes, light and dark, and the parts the gallery promises", () => {
    const themes = loaded.map((l) => l.meta.theme);
    expect(new Set(themes).size).toBe(8);
    for (const t of themes) expect(THEME_IDS).toContain(t);
    expect(
      loaded.filter((l) => l.meta.mode === "dark").length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      loaded.filter((l) => l.meta.mode === "light").length,
    ).toBeGreaterThanOrEqual(4);
    const types = new Set(
      loaded.flatMap((l) => allLayers(l.spec).map((x) => x.type)),
    );
    for (const t of ["Chart", "FilterBar", "Checklist", "ProgressBar"])
      expect(types.has(t), t).toBe(true);
    expect(loaded.some((l) => menuLayers(l.spec).length > 0)).toBe(true);
  });

  it("Invoices and Clients numbers its invoices and sets Paid on from Paid (phase 28)", () => {
    const entry = loaded.find((l) => l.meta.id === "invoices-and-clients");
    expect(entry).toBeDefined();
    const { spec, records, body } = entry!;
    const result = validateAppSpec(body.spec, { ...CATALOG_CHECKS });
    expect(result.issues).toEqual([]);
    const invoices = spec.tables.find((t) => t.id === "invoices")!;
    const number = invoices.fields.find((f) => f.id === "number")!;
    expect(number.type).toBe("text");
    expect("autoNumber" in number ? number.autoNumber : undefined).toEqual({
      prefix: "INV-",
      start: 1001,
      width: 4,
    });
    expect(invoices.fields.filter((f) => "autoNumber" in f && f.autoNumber)).toHaveLength(1);
    const paidOn = invoices.fields.find((f) => f.id === "paid_on");
    expect(paidOn).toMatchObject({ type: "date", label: "Paid on" });
    expect(paidOn?.required).not.toBe(true);
    expect(invoices.rules).toEqual([
      { when: { field: "paid", is: true }, then: [{ set: "paid_on", to: "today" }] },
      { when: { field: "paid", is: false }, then: [{ set: "paid_on", to: "clear" }] },
    ]);
    // The record page form lists Paid, Paid on and Due.
    const form = allLayers(spec).find((l) => l.type === "RecordForm" && l.props.mode === "edit");
    expect(form?.props.fields).toEqual(["paid", "paid_on", "due"]);
    // The home table still shows the number.
    const home = spec.pages.find((p) => p.route === "/")!;
    const homeTable = allLayers({ ...spec, pages: [home] }).find((l) => l.type === "DataTable");
    expect(homeTable?.props.columns).toContain("number");
    // The sample rows carry no number (the app numbers them), and a paid row has a Paid on date as a token.
    const rows = records.tables.invoices;
    expect(rows.some((r) => "number" in r)).toBe(false);
    const paid = rows.filter((r) => r.paid === true);
    expect(paid.length).toBeGreaterThan(0);
    for (const r of paid) expect(isToken(r.paid_on), "paid row has paid_on").toBe(true);
    for (const r of rows.filter((x) => x.paid !== true)) expect(r.paid_on).toBeUndefined();
  });

  it("stays under the size budget for all specs and records together", () => {
    const total = loaded.reduce((n, l) => n + l.bytes, 0);
    const lines = loaded.map((l) => `${l.meta.id} ${l.bytes}`).join(", ");
    expect(total, `total ${total} (${lines})`).toBeLessThanOrEqual(SIZE_LIMIT);
  });

  it("has no em or en dash and no personal data in any example file", () => {
    const denylist = loadDenylist();
    const hashedDenylist = loadHashedDenylist();
    const files = [
      "index.ts",
      ...EXAMPLES.flatMap((e) => [`${e.id}.spec.json`, `${e.id}.records.json`]),
    ];
    for (const file of files) {
      const text = read(file);
      expect(text.length, file).toBeGreaterThan(0);
      expect(text, file).not.toMatch(/[\u2013\u2014]/);
      expect(scan(text, { denylist, hashedDenylist }), file).toEqual([]);
    }
  });
});
