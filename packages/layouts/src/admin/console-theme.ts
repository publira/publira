/**
 * The console a shell belongs to. `@publira/layouts/styles.css` matches the
 * value on `data-console-theme` and paints that console's background gradient.
 */
export type ConsoleTheme = "admin" | "platform";

export const consoleBackgroundClassName =
  "publira-console-background pointer-events-none absolute inset-0";
