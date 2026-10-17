import { teamsHighContrastTheme, webDarkTheme, webLightTheme, type Theme } from "@fluentui/react-components";
import { describe, expect, it } from "vitest";
import { hostDirection, hostTheme } from "../shared/theme";
import { fieldContext } from "./mockContext";

/** WCAG relative luminance contrast for two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
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
];
const NON_TEXT: [keyof Theme, keyof Theme][] = [["colorStrokeFocus2", "colorNeutralBackground1"]];

describe("theme", () => {
  for (const [name, theme] of [["light", webLightTheme], ["dark", webDarkTheme], ["high contrast", teamsHighContrastTheme]] as const) {
    it(`keeps text at 4.5:1 and focus at 3:1 in the ${name} theme`, () => {
      for (const [foreground, background] of TEXT) {
        expect(contrast(String(theme[foreground]), String(theme[background])), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const [foreground, background] of NON_TEXT) {
        expect(contrast(String(theme[foreground]), String(theme[background])), `${foreground} on ${background}`).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it("follows the host: its tokens when it passes them, else light or dark as it says", () => {
    const custom = { ...webLightTheme, colorNeutralBackground1: "#fafafa" };
    expect(hostTheme(fieldContext({ tokenTheme: custom }))).toBe(custom);
    expect(hostTheme(fieldContext({ dark: true }))).toBe(webDarkTheme);
    expect(hostTheme(fieldContext())).toBe(webLightTheme);
  });

  it("writes right to left for right-to-left languages", () => {
    expect(hostDirection(fieldContext({ rtl: true }))).toBe("rtl");
    expect(hostDirection(fieldContext())).toBe("ltr");
  });
});
