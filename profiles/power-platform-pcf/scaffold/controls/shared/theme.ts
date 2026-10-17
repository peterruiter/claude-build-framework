/**
 * The host's theme. Model-driven apps with the modern look and canvas apps with modern themes
 * pass Fluent v9 tokens in context.fluentDesignLanguage; the control renders with them, so it is
 * light or dark (and follows display density) exactly as the app around it. Hosts without modern
 * theming (the test harness, classic forms) get the Fluent web theme matching isDarkTheme.
 * Read it in every updateView: the theme can change while the control is on screen.
 */
import { webDarkTheme, webLightTheme, type Theme } from "@fluentui/react-components";

export function hostTheme(context: ComponentFramework.Context<unknown>): Theme {
  const design = context.fluentDesignLanguage;
  if (design?.tokenTheme) return design.tokenTheme as unknown as Theme;
  return design?.isDarkTheme ? webDarkTheme : webLightTheme;
}

/** Text direction for the reader's language (Arabic and Hebrew are right to left). */
export function hostDirection(context: ComponentFramework.Context<unknown>): "ltr" | "rtl" {
  return context.userSettings.isRTL ? "rtl" : "ltr";
}
