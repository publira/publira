// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import * as ConsoleHeader from "./admin/console-header";
import * as ConsoleLayout from "./admin/console-layout";
import * as ConsolePage from "./admin/console-page";
import * as ConsoleSection from "./admin/console-section";
import * as ConsoleSidebar from "./admin/console-sidebar";
import * as ConsoleUserMenu from "./admin/console-user-menu";
import * as AuthScreen from "./auth-screen";
import * as SiteLayout from "./site-layout";

const namespaces = {
  AuthScreen,
  ConsoleHeader,
  ConsoleLayout,
  ConsolePage,
  ConsoleSection,
  ConsoleSidebar,
  ConsoleUserMenu,
  SiteLayout,
};

describe("compound component namespaces", () => {
  // A part is renamed only where its subpath exports it, so React DevTools,
  // error overlays, and stack traces keep naming the layout a part belongs to
  // instead of showing `Root` and `Header` for every tree in the package.
  it.each(Object.entries(namespaces))(
    "%s keeps each part's declared name",
    (namespace, parts) => {
      for (const [key, part] of Object.entries(parts)) {
        expect(typeof part, `${namespace}.${key}`).toBe("function");
        expect(part.name, `${namespace}.${key}`).not.toBe(key);
      }
    }
  );
});
