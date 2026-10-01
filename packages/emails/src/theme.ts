/**
 * Email palette. Mail clients ignore CSS variables and external stylesheets, so the app's design
 * tokens (`apps/web/src/app/globals.css`) cannot be used here: these inline values mirror the
 * light theme (neutral foreground/muted/border, primary button) and keep WCAG AA contrast.
 */
export const emailTheme = {
  background: "#f4f4f5",
  card: "#ffffff",
  foreground: "#18181b",
  muted: "#52525b",
  border: "#e4e4e7",
  primary: "#18181b",
  primaryForeground: "#fafafa",
  link: "#1d4ed8",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
} as const;
