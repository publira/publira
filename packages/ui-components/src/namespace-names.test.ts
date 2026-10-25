// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import * as ActionForm from "./action-form";
import * as Card from "./card";
import * as Chart from "./chart";
import * as Combobox from "./combobox";
import * as ConfirmDialog from "./confirm-dialog";
import * as Dialog from "./dialog";
import * as Drawer from "./drawer";
import * as EmptyState from "./empty-state";
import * as Field from "./field";
import * as FigureLine from "./figure-line";
import * as Identifier from "./identifier";
import * as LocaleSwitcher from "./locale-switcher";
import * as MultiCombobox from "./multi-combobox";
import * as PasswordInput from "./password-input";
import * as Popover from "./popover";
import * as SectionError from "./section-error";
import * as SectionErrorCatch from "./section-error-fallback";
import * as Table from "./table";
import * as Tabs from "./tabs";
import * as Toast from "./toast";

const namespaces = {
  ActionForm,
  Card,
  Chart,
  Combobox,
  ConfirmDialog,
  Dialog,
  Drawer,
  EmptyState,
  Field,
  FigureLine,
  Identifier,
  LocaleSwitcher,
  MultiCombobox,
  PasswordInput,
  Popover,
  SectionError,
  SectionErrorCatch,
  Table,
  Tabs,
  Toast,
};

// `Figure` is the part's full name as well as its key.
const fullNameKeys = new Set(["FigureLine.Figure"]);

describe("compound component namespaces", () => {
  // A part is renamed only where its subpath exports it, so React DevTools,
  // error overlays, and stack traces keep naming the component a tree holds
  // instead of showing `Root` and `Trigger` for every tree in the package.
  it.each(Object.entries(namespaces))(
    "%s keeps each part's declared name",
    (namespace, parts) => {
      for (const [key, part] of Object.entries(parts)) {
        if (
          typeof part === "function" &&
          !fullNameKeys.has(`${namespace}.${key}`)
        ) {
          expect(part.name, `${namespace}.${key}`).not.toBe(key);
        }
      }
    }
  );
});
