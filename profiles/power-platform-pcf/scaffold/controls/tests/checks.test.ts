// The control checks catch the mistakes they exist for, on a scratch copy of the project.
// Whatever languages the project offers: the tampering picks a language other than the source.
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkProject } from "../scripts/check-controls.mjs";
import { localesPath, neededCategories, readLocales } from "../scripts/lib.mjs";

const root = join(__dirname, "..");
const locales = readLocales(localesPath([]));
const other = locales.locales.find((locale) => locale.lcid !== locales.source.lcid);
const copies: string[] = [];

function copy(): string {
  const folder = mkdtempSync(join(tmpdir(), "pcf-checks-"));
  copies.push(folder);
  cpSync(root, folder, {
    recursive: true,
    filter: (path) => !/[\\/](node_modules|out|obj|bin|generated)([\\/]|$)/.test(path.slice(root.length)),
  });
  return folder;
}

const strings = (folder: string, control: string, lcid: number | null) =>
  join(folder, control, control, "strings", `${control}.${String(lcid)}.resx`);
const manifestOf = (folder: string, control: string) => join(folder, control, control, "ControlManifest.Input.xml");
const edit = (path: string, change: (text: string) => string) => writeFileSync(path, change(readFileSync(path, "utf8")));
const dataLine = (key: string) => new RegExp(`\\s*<data name="${key.replace(/\./g, "\\.")}"[^\\n]*`);

afterEach(() => {
  for (const folder of copies.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("check-controls", () => {
  it("passes the project as it is", () => {
    const result = checkProject(root, { locales });
    expect(result.errors).toEqual([]);
    expect(result.controls).toBe(2);
  });

  it("knows which plural forms each language needs", () => {
    expect(neededCategories("en-GB")).toEqual(["one"]);
    expect(neededCategories("pl-PL")).toEqual(["one", "few", "many"]);
    expect(neededCategories("ja-JP")).toEqual([]);
  });

  it.skipIf(!other)("catches a missing string, a changed placeholder, a missing plural form and an unlisted language", () => {
    const folder = copy();
    const language = other!;
    const category = neededCategories(language.culture)[0];
    edit(strings(folder, "SampleControl", language.lcid), (text) => {
      let changed = text.replace(dataLine("field.hidden"), "");
      changed = changed.replace(/(<data name="field\.clearLabel"[^>]*><value>[^<]*?)\{0\}/, "$1");
      if (category) changed = changed.replace(dataLine(`field.counter.${category}`), "");
      return changed;
    });
    edit(manifestOf(folder, "SampleGrid"), (text) => text.replace(new RegExp(`\\s*<resx path="strings/SampleGrid\\.${String(language.lcid)}\\.resx"[^>]*/>`), ""));

    const errors = checkProject(folder, { locales }).errors.join("\n");
    expect(errors).toMatch(/'field\.hidden' is missing/);
    expect(errors).toMatch(/'field\.clearLabel' does not carry the same placeholders/);
    if (category) expect(errors).toMatch(new RegExp(`'field\\.counter' is counted and needs \\.${category}`));
    expect(errors).toMatch(new RegExp(`SampleGrid\\.${String(language.lcid)}\\.resx is not listed in the manifest`));
  });

  it("refuses a network call the manifest does not declare, and a feature it does not declare", () => {
    const folder = copy();
    appendFileSync(join(folder, "SampleControl", "SampleControl", "index.ts"), "\nexport const ping = () => fetch('https://example.com/track');\n");
    appendFileSync(join(folder, "SampleGrid", "SampleGrid", "index.ts"), "\nexport const who = (context: { webAPI: unknown }) => context.webAPI;\n");
    const errors = checkProject(folder, { locales }).errors.join("\n");
    expect(errors).toMatch(/uses fetch\(\), and SampleControl declares no external-service-usage/);
    expect(errors).toMatch(/uses WebAPI and SampleGrid's manifest has no <uses-feature name="WebAPI">/);
  });

  it("warns about untranslated strings, and refuses them for a release", () => {
    const folder = copy();
    edit(strings(folder, "SampleGrid", locales.source.lcid), (text) =>
      text.replace(/(<data name="grid\.previous"[^>]*><value>[^<]*<\/value>)(?:<comment>[^<]*<\/comment>)?/, "$1<comment>untranslated</comment>"),
    );
    expect(checkProject(folder, { locales }).warnings.join("\n")).toMatch(/\d+ string\(s\) still marked untranslated/);
    expect(checkProject(folder, { locales, strict: true }).errors.join("\n")).toMatch(/\d+ string\(s\) still marked untranslated/);
  });

  it("refuses a manifest that asks the platform for another React than the one tested", () => {
    const folder = copy();
    edit(manifestOf(folder, "SampleControl"), (text) => text.replace('name="React" version="16.14.0"', 'name="React" version="18.3.1"'));
    expect(checkProject(folder, { locales }).errors.join("\n")).toMatch(/asks the platform for React 18\.3\.1, package\.json builds and tests with 16\.14\.0/);
  });
});
