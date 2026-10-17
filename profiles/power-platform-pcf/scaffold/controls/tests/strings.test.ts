import { describe, expect, it, vi } from "vitest";

// Polish is not one of the sample's configured languages; the plural tests need a language with
// more forms than English, so the language table is replaced for this file only.
vi.mock("../shared/languages.generated", () => ({
  cultureFor: (id: number) => ({ 1045: "pl-PL", 1043: "nl-NL", 1036: "fr-FR" } as Record<number, string>)[id] ?? "en-GB",
}));

import { createStrings } from "../shared/strings";

const lookupFrom = (strings: Record<string, string>) => (key: string) => strings[key] ?? key;

describe("createStrings", () => {
  it("picks the CLDR form of a counted string per culture", () => {
    const polish = createStrings(
      lookupFrom({ tickets: "{0} biletów", "tickets.one": "{0} bilet", "tickets.few": "{0} bilety", "tickets.many": "{0} biletów" }),
      1045,
      {},
    );
    expect([1, 2, 5, 12, 22, 25, 102].map((count) => polish.counted("tickets", count))).toEqual([
      "1 bilet", "2 bilety", "5 biletów", "12 biletów", "22 bilety", "25 biletów", "102 bilety",
    ]);
    const english = createStrings(lookupFrom({ items: "{0} items", "items.one": "{0} item" }), 1033, {});
    expect(english.counted("items", 1)).toBe("1 item");
    expect(english.counted("items", 0)).toBe("0 items");
  });

  it("reads 0 as one in French, and falls back to the key itself when a form is missing", () => {
    const french = createStrings(lookupFrom({ seats: "{0} places", "seats.one": "{0} place" }), 1036, {});
    expect(french.counted("seats", 0)).toBe("0 place");
    const incomplete = createStrings(lookupFrom({ tickets: "{0} biletów" }), 1045, {});
    expect(incomplete.counted("tickets", 2)).toBe("2 biletów");
  });

  it("formats numbers for the culture, in placeholders too", () => {
    const dutch = createStrings(lookupFrom({ rows: "{0} rijen" }), 1043, {});
    expect(dutch.counted("rows", 1234)).toBe("1.234 rijen");
    expect(dutch.number(1234.5)).toBe("1.234,5");
    const english = createStrings(lookupFrom({ greet: "Hello {0}, you have {1} new" }), 1033, {});
    expect(english.text("greet", "Ann", 3)).toBe("Hello Ann, you have 3 new");
  });

  it("uses the built-in default language when the platform has no string, and never shows a key it can avoid", () => {
    // The platform returns the key itself for a key its RESX file does not have.
    const strings = createStrings(lookupFrom({}), 1043, { "field.clear": "Clear" });
    expect(strings.text("field.clear")).toBe("Clear");
    expect(strings.text("not.anywhere")).toBe("not.anywhere");
    const empty = createStrings(() => "", 1043, { "field.clear": "Clear" });
    expect(empty.text("field.clear")).toBe("Clear");
  });
});
