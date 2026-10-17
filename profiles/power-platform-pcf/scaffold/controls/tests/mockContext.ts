/**
 * A ComponentFramework context for unit tests: only what the controls read, typed loosely and
 * cast at the end. Strings come from the real RESX files, so a test in any configured language
 * reads the file the platform would serve. The tests do not hard-code a language: they expect
 * what the RESX file of the default language (or of each configured language) says, so they
 * pass for whatever languages the project offers.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import { CULTURES, DEFAULT_LCID } from "../shared/languages.generated";
import type { IInputs as FieldInputs } from "../SampleControl/SampleControl/generated/ManifestTypes";
import type { IInputs as GridInputs } from "../SampleGrid/SampleGrid/generated/ManifestTypes";

/** The default language and every configured language (from build/contracts/locales.json). */
export const DEFAULT = DEFAULT_LCID;
export const LANGUAGES = Object.keys(CULTURES).map(Number);
/** A Dataverse language the project does not offer, for the fallback tests. */
export const UNCONFIGURED = [1053, 1087, 1110, 1069].find((lcid) => !(lcid in CULTURES)) ?? 0;

const root = join(__dirname, "..");

/** The strings of a control's RESX file for a language, as the platform would serve them. */
export function resx(control: string, lcid: number): Record<string, string> {
  const path = join(root, control, control, "strings", `${control}.${lcid}.resx`);
  if (!existsSync(path)) return {};
  const strings: Record<string, string> = {};
  for (const [, key, value] of readFileSync(path, "utf8").matchAll(/<data name="([^"]+)"[^>]*><value>([\s\S]*?)<\/value>/g)) {
    strings[key] = value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  }
  return strings;
}

/** What a reader of the language sees for a key: the RESX value with {0}, {1} ... filled in. */
export function expected(control: string, key: string, args: (string | number)[] = [], lcid = DEFAULT): string {
  const culture = CULTURES[lcid];
  const numbers = new Intl.NumberFormat(culture);
  const value = resx(control, lcid)[key] ?? key;
  return value.replace(/\{(\d+)\}/g, (_, index: string) => {
    const arg = args[Number(index)];
    return typeof arg === "number" ? numbers.format(arg) : String(arg);
  });
}

/** The plural form a reader of the language sees for a count (CLDR category of the culture). */
export function expectedCount(control: string, key: string, count: number, lcid = DEFAULT): string {
  const category = new Intl.PluralRules(CULTURES[lcid]).select(count);
  const strings = resx(control, lcid);
  const form = category !== "other" && strings[`${key}.${category}`] !== undefined ? `${key}.${category}` : key;
  return expected(control, form, [count], lcid);
}

interface Host {
  control: string;
  lcid?: number;
  width?: number;
  disabled?: boolean;
  dark?: boolean;
  tokenTheme?: unknown;
  rtl?: boolean;
}

function base(host: Host) {
  const strings = resx(host.control, host.lcid ?? DEFAULT);
  return {
    // getString returns the key itself for a key it does not know, like the platform.
    resources: { getString: vi.fn((key: string) => strings[key] ?? key) },
    userSettings: { languageId: host.lcid ?? DEFAULT, isRTL: host.rtl ?? false, userId: "{00000000-0000-0000-0000-000000000001}" },
    mode: {
      isControlDisabled: host.disabled ?? false,
      allocatedWidth: host.width ?? 800,
      allocatedHeight: -1,
      trackContainerResize: vi.fn(),
    },
    fluentDesignLanguage: host.tokenTheme || host.dark !== undefined
      ? { tokenTheme: host.tokenTheme, isDarkTheme: host.dark ?? false }
      : undefined,
  };
}

export interface FieldOptions extends Omit<Host, "control"> {
  value?: string | null;
  label?: string;
  maxLength?: number;
  readable?: boolean;
  editable?: boolean;
  showCounter?: boolean;
}

export function fieldContext(options: FieldOptions = {}): ComponentFramework.Context<FieldInputs> {
  return {
    ...base({ control: "SampleControl", ...options }),
    parameters: {
      value: {
        raw: options.value === undefined ? "Hello" : options.value,
        attributes: { DisplayName: options.label ?? "Account name", MaxLength: options.maxLength ?? 0 },
        security: { readable: options.readable ?? true, editable: options.editable ?? true, secured: false },
      },
      showCounter: { raw: options.showCounter ?? true },
    },
  } as unknown as ComponentFramework.Context<FieldInputs>;
}

export interface GridRecord {
  id: string;
  values: Record<string, string>;
}

export interface GridOptions extends Omit<Host, "control"> {
  records?: GridRecord[];
  selected?: string[];
  loading?: boolean;
  error?: boolean;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
  total?: number;
  pageSize?: number | null;
  currentPageSize?: number;
}

export const SAMPLE_RECORDS: GridRecord[] = [
  { id: "a1", values: { name: "Fourth Coffee", city: "Utrecht" } },
  { id: "a2", values: { name: "Litware", city: "Gent" } },
  { id: "a3", values: { name: "", city: "Aarhus" } },
];

export function gridContext(options: GridOptions = {}) {
  const records = options.records ?? SAMPLE_RECORDS;
  let selected = options.selected ?? [];
  const dataset = {
    loading: options.loading ?? false,
    error: options.error ?? false,
    columns: [
      { name: "city", displayName: "City", order: 1, isHidden: false, dataType: "SingleLine.Text" },
      { name: "name", displayName: "Account name", order: 0, isHidden: false, isPrimary: true, dataType: "SingleLine.Text" },
      { name: "secret", displayName: "Hidden column", order: 2, isHidden: true, dataType: "SingleLine.Text" },
    ],
    sortedRecordIds: records.map((record) => record.id),
    records: Object.fromEntries(
      records.map((record) => [
        record.id,
        {
          getRecordId: () => record.id,
          getFormattedValue: (column: string) => record.values[column] ?? null,
          getNamedReference: () => ({ id: { guid: record.id }, etn: "account", name: record.values.name }),
        },
      ]),
    ),
    sorting: [] as { name: string; sortDirection: number }[],
    paging: {
      pageSize: options.currentPageSize ?? 25,
      hasNextPage: options.hasNextPage ?? false,
      hasPreviousPage: options.hasPreviousPage ?? false,
      totalResultCount: options.total ?? records.length,
      setPageSize: vi.fn(),
      reset: vi.fn(),
      loadExactPage: vi.fn(),
    },
    getTitle: () => "Active accounts",
    getSelectedRecordIds: vi.fn(() => selected),
    setSelectedRecordIds: vi.fn((ids: string[]) => {
      selected = ids;
    }),
    openDatasetItem: vi.fn(),
    refresh: vi.fn(),
  };
  const context = {
    ...base({ control: "SampleGrid", ...options }),
    parameters: { records: dataset, pageSize: { raw: options.pageSize === undefined ? 25 : options.pageSize } },
  } as unknown as ComponentFramework.Context<GridInputs>;
  return { context, dataset };
}
