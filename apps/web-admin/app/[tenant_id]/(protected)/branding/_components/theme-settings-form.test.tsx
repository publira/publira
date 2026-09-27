// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { DEFAULT_TENANT_THEME } from "@publira/utils/theme-css-variables";
import {
  act,
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import type { ThemeSettingsActionState } from "../branding-types";
import { ThemeSettingsForm } from "./theme-settings-form";

const { save } = vi.hoisted(() => ({
  save: {
    action: (() => Promise.resolve(null)) as (
      state: ThemeSettingsActionState,
      data: FormData
    ) => Promise<ThemeSettingsActionState>,
  },
}));

vi.mock("../_lib/actions", () => ({
  updateTenantThemeSettingsAction: (
    state: ThemeSettingsActionState,
    data: FormData
  ) => save.action(state, data),
}));

vi.mock("#components/client-message", () => ({
  ClientMessage: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
  useClientMessages: () => bindMessages(sharedCatalog("en")),
}));

vi.mock("#components/message", () => ({
  Message: ({ message }: { message: MessageKey<SharedMessages> }) =>
    bindMessages(sharedCatalog("en"))(message),
}));

const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
    ),
  });

const renderForm = async (
  action: typeof save.action = () => Promise.resolve(null)
): Promise<HTMLElement> => {
  save.action = action;
  let container: HTMLElement | undefined;

  await act(() => {
    ({ container } = render(
      <ThemeSettingsForm
        initialTheme={DEFAULT_TENANT_THEME}
        tenantId="TENANT001"
      />
    ));
  });

  if (!container) {
    throw new Error("the form did not render");
  }

  return container;
};

const openTab = async (name: string): Promise<void> => {
  await act(() => {
    fireEvent.click(screen.getByRole("tab", { name }));
  });
};

const previewFrame = (container: HTMLElement): HTMLElement => {
  const frame = container.querySelector<HTMLElement>(".publira-theme-scope");
  if (!frame) {
    throw new Error("the preview frame is missing");
  }

  return frame;
};

afterEach(() => {
  cleanup();
});

describe("ThemeSettingsForm", () => {
  it("opens on the fields, with the preview behind its own tab", async () => {
    const container = await renderForm();

    expect(
      screen.getByRole("tab", { name: "Edit", selected: true })
    ).toBeTruthy();
    expect(
      screen.getByRole("textbox", { name: /Primary color/u })
    ).toBeTruthy();
    expect(container.querySelector(".publira-theme-scope")).toBeNull();
  });

  it("shows the edited colors on the preview tab before they are saved", async () => {
    const container = await renderForm();

    await act(() => {
      fireEvent.change(
        screen.getByRole("textbox", { name: /Primary color/u }),
        {
          target: { value: "#ff0000" },
        }
      );
    });
    await openTab("Preview");

    expect(
      previewFrame(container).style.getPropertyValue("--publira-color-primary")
    ).toBe("#ff0000");
  });

  it("keeps the selected tab when the save fails", async () => {
    await renderForm(() =>
      Promise.resolve({
        fieldErrors: { primaryColor: "Enter a color as #RRGGBB." },
        message: "Could not save the theme. Please try again later.",
        ok: false,
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Save the theme" }));

    expect(await screen.findByText("Enter a color as #RRGGBB.")).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Edit", selected: true })
    ).toBeTruthy();
  });

  // The Action carries the palette the form held when it was submitted, so a
  // change made while it is in flight would show in the preview unsaved.
  it("closes every field while the save is in flight", async () => {
    // Never resolved: the assertions are about the window the save is open in.
    const container = await renderForm(
      () => Promise.withResolvers<never>().promise
    );

    // A control its `<fieldset>` closes keeps `disabled` false and matches
    // `:disabled` instead.
    const controls = () => [
      screen.getByRole("textbox", { name: /Reading and display stack/u }),
      screen.getByRole("textbox", { name: /Primary color/u }),
      ...container.querySelectorAll<HTMLInputElement>('input[type="color"]'),
    ];

    expect(controls().length).toBeGreaterThan(2);
    for (const control of controls()) {
      expect(control.matches(":disabled")).toBe(false);
    }

    fireEvent.click(screen.getByRole("button", { name: "Save the theme" }));

    await waitFor(() => {
      for (const control of controls()) {
        expect(control.matches(":disabled")).toBe(true);
      }
    });
  });

  it("adopts the palette the save stored", async () => {
    await renderForm(() =>
      Promise.resolve({
        message: "The theme was saved.",
        ok: true,
        theme: { ...DEFAULT_TENANT_THEME, primaryColor: "#aabbcc" },
      })
    );

    fireEvent.change(screen.getByRole("textbox", { name: /Primary color/u }), {
      target: { value: "#AABBCC" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save the theme" }));

    await waitFor(() => {
      expect(
        screen.getByRole<HTMLInputElement>("textbox", {
          name: /Primary color/u,
        }).value
      ).toBe("#aabbcc");
    });
  });
});
