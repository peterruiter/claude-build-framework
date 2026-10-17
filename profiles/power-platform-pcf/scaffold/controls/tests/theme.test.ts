import { teamsHighContrastTheme, type Theme } from "@fluentui/react-components";
import { describe, expect, it } from "vitest";
import { brand, darkTheme, lightTheme } from "../shared/design-system/fluent-theme";
import { designSystem } from "../shared/design-system/tokens";
import { hostDirection, hostTheme } from "../shared/theme";
import { fieldContext } from "./mockContext";

/** WCAG relative luminance contrast for two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// The token pairs the controls use for text and focus. Fluent's own components carry their own
// checks; these are the colours the controls choose themselves.
const TEXT: [keyof Theme, keyof Theme][] = [
  ["colorNeutralForeground1", "colorNeutralBackground1"],
  ["colorNeutralForeground2", "colorNeutralBackground1"],
  ["colorBrandForegroundLink", "colorNeutralBackground1"],
  ["colorNeutralForegroundOnBrand", "colorBrandBackground"],
];
const NON_TEXT: [keyof Theme, keyof Theme][] = [["colorStrokeFocus2", "colorNeutralBackground1"]];

// The design system's themes (generated: shared/design-system), and Fluent's high-contrast theme,
// which a host can pass.
const themes = [["light", lightTheme], ["dark", darkTheme], ["high contrast", teamsHighContrastTheme]] as const;

describe("theme", () => {
  for (const [name, theme] of themes) {
    it(`keeps text at 4.5:1 and focus at 3:1 in the ${name} theme`, () => {
      for (const [foreground, background] of TEXT) {
        expect(contrast(String(theme[foreground]), String(theme[background])), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const [foreground, background] of NON_TEXT) {
        expect(contrast(String(theme[foreground]), String(theme[background])), `${foreground} on ${background}`).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it("takes its colours and font from the design system", () => {
    for (const [name, theme] of [["light", lightTheme], ["dark", darkTheme]] as const) {
      const roles = designSystem.roles[name];
      expect(theme.colorNeutralBackground1, `${name} surface`).toBe(roles.surface);
      expect(theme.colorNeutralForeground1, `${name} text`).toBe(roles.text);
      expect(theme.colorBrandBackground, `${name} accent`).toBe(roles.accent);
      expect(theme.colorNeutralForegroundOnBrand, `${name} text on the accent`).toBe(roles.textInverse);
      expect(theme.colorStrokeFocus2, `${name} focus`).toBe(roles.focus);
    }
    expect(Object.keys(brand)).toHaveLength(16);
    expect(lightTheme.fontFamilyBase).toContain(designSystem.fonts.families.sans.split(",")[0].trim());
  });

  it("meets the design system's own contrast pairs in both themes", () => {
    for (const name of ["light", "dark"] as const) {
      const values: Record<string, string> = designSystem.themes[name];
      for (const pair of designSystem.contrast.pairs as readonly { fg: string; bg: string; min: number; themes?: readonly string[] }[]) {
        if (pair.themes && !pair.themes.includes(name)) continue;
        expect(contrast(values[pair.fg], values[pair.bg]), `${name}: ${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(pair.min);
      }
    }
  });

  it("follows the host's theme when it passes one, else the design system, light or dark as the host says", () => {
    const host = { ...darkTheme };
    expect(hostTheme(fieldContext({ tokenTheme: host }))).toBe(host);
    expect(hostTheme(fieldContext({ dark: true }))).toBe(darkTheme);
    expect(hostTheme(fieldContext())).toBe(lightTheme);
  });

  it("carries the design system inside an app when the control asks for it", () => {
    const host = { ...darkTheme };
    expect(hostTheme(fieldContext({ tokenTheme: host }), { carryBrand: true })).toBe(lightTheme);
    expect(hostTheme(fieldContext({ tokenTheme: host, dark: true }), { carryBrand: true })).toBe(darkTheme);
  });

  it("writes right to left for right-to-left languages", () => {
    expect(hostDirection(fieldContext({ rtl: true }))).toBe("rtl");
    expect(hostDirection(fieldContext())).toBe("ltr");
  });
});
