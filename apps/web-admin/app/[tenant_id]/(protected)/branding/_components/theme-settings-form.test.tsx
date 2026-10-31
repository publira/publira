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
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import { deriveDarkPalette } from "../_lib/dark-palette";
import type {
  DarkThemeSettingsActionState,
  ThemeSettingsActionState,
} from "../branding-types";
import { ThemeSettingsForm } from "./theme-settings-form";

const { save, saveDark } = vi.hoisted(() => ({
  save: {
    action: (() => Promise.resolve(null)) as (
      state: ThemeSettingsActionState,
      data: FormData
    ) => Promise<ThemeSettingsActionState>,
  },
  saveDark: {
    action: (() => Promise.resolve(null)) as (
      state: DarkThemeSettingsActionState,
      data: FormData
    ) => Promise<DarkThemeSettingsActionState>,
  },
}));

vi.mock("../_lib/actions", () => ({
  deleteTenantDarkThemeAction: () => Promise.resolve(null),
  updateTenantDarkThemeAction: (
    state: DarkThemeSettingsActionState,
    data: FormData
  ) => saveDark.action(state, data),
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
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
  useClientMessages: () => bindMessages(sharedCatalog("en"), "en"),
}));

vi.mock("#components/message", () => ({
  Message: ({ message }: { message: MessageKey<SharedMessages> }) =>
    bindMessages(sharedCatalog("en"), "en")(message),
}));

const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
    ),
  });

const DERIVED_DARK_THEME = deriveDarkPalette(DEFAULT_TENANT_THEME);

const SAVED_DARK_THEME = {
  ...DERIVED_DARK_THEME,
  primaryColor: "#8fb0f0",
};

const renderForm = async (
  action: typeof save.action = () => Promise.resolve(null),
  {
    darkAction = () => Promise.resolve(null),
    darkTheme = { darkTheme: null, ok: true },
  }: {
    darkAction?: typeof saveDark.action;
    darkTheme?: ComponentProps<typeof ThemeSettingsForm>["darkTheme"];
  } = {}
): Promise<HTMLElement> => {
  save.action = action;
  saveDark.action = darkAction;
  let container: HTMLElement | undefined;

  await act(() => {
    ({ container } = render(
      <ThemeSettingsForm
        darkTheme={darkTheme}
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

/** The preview frames in the order the tab draws them: light, then dark. */
const previewFrame = (container: HTMLElement, index = 0): HTMLElement => {
  const frame = container.querySelectorAll<HTMLElement>(".publira-theme-scope")[
    index
  ];

  if (!frame) {
    throw new Error("the preview frame is missing");
  }

  return frame;
};

const colorField = (name: RegExp): HTMLInputElement =>
  screen.getByRole<HTMLInputElement>("textbox", { name });

/**
 * How long a case waits for what the form renders after "Save the theme": the
 * fields closing while the Action is in flight, or what the mocked Action
 * returned. Both land well inside the 1000ms `findBy*` / `waitFor` default on an
 * idle machine, but not on a runner busy with the whole `Test / TypeScript`
 * job, where a wait has been seen to take longer than that.
 */
const onScreen = { timeout: 5000 };

/**
 * A case waits on the screen once, after rendering the form, so it is given
 * room for that wait to use its whole budget on top of the render.
 */
const caseTimeout = 2 * onScreen.timeout;

afterEach(() => {
  cleanup();
});

describe("ThemeSettingsForm", { timeout: caseTimeout }, () => {
  it("opens on the fields, with the preview behind its own tab", async () => {
    const container = await renderForm();

    expect(
      screen.getByRole("tab", { name: "Light", selected: true })
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

    expect(
      await screen.findByText("Enter a color as #RRGGBB.", {}, onScreen)
    ).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Light", selected: true })
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
    }, onScreen);
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
    }, onScreen);
  });
  it("opens the dark tab on the palette derived from the light one when none is saved", async () => {
    await renderForm();
    await openTab("Dark");

    expect(
      screen.getByText(/No dark palette is saved\./u, { exact: false })
    ).toBeTruthy();
    expect(colorField(/^Background color/u).value).toBe(
      DERIVED_DARK_THEME.backgroundColor
    );
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("opens the dark tab on the saved dark palette, with its delete action", async () => {
    await renderForm(undefined, {
      darkTheme: { darkTheme: SAVED_DARK_THEME, ok: true },
    });
    await openTab("Dark");

    expect(colorField(/^Primary color/u).value).toBe("#8fb0f0");
    expect(screen.queryByText(/No dark palette is saved\./u)).toBeNull();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("keeps the two palettes apart and shows each on the preview tab", async () => {
    const container = await renderForm();

    await act(() => {
      fireEvent.change(colorField(/^Primary color/u), {
        target: { value: "#ff0000" },
      });
    });
    await openTab("Dark");
    expect(colorField(/^Primary color/u).value).toBe(
      DERIVED_DARK_THEME.primaryColor
    );
    await act(() => {
      fireEvent.change(colorField(/^Primary color/u), {
        target: { value: "#00ff00" },
      });
    });
    await openTab("Light");
    expect(colorField(/^Primary color/u).value).toBe("#ff0000");

    await openTab("Preview");
    expect(
      previewFrame(container, 0).style.getPropertyValue(
        "--publira-color-primary"
      )
    ).toBe("#ff0000");
    expect(
      previewFrame(container, 1).style.getPropertyValue(
        "--publira-color-primary"
      )
    ).toBe("#00ff00");
  });

  // The console is drawn in light colors, so a dark edit painted onto it would
  // show the dark palette's colors on a screen they were never meant for.
  it("leaves the console's own colors alone while the dark palette is edited", async () => {
    await renderForm();
    await openTab("Dark");

    const before = document.documentElement.style.getPropertyValue(
      "--publira-color-primary"
    );

    await act(() => {
      fireEvent.change(colorField(/^Primary color/u), {
        target: { value: "#00ff00" },
      });
    });

    expect(
      document.documentElement.style.getPropertyValue("--publira-color-primary")
    ).toBe(before);
  });

  it("derives the dark palette again from the light palette the form holds", async () => {
    await renderForm(undefined, {
      darkTheme: { darkTheme: SAVED_DARK_THEME, ok: true },
    });

    await act(() => {
      fireEvent.change(colorField(/^Background color/u), {
        target: { value: "#ffffff" },
      });
    });
    await openTab("Dark");
    await act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Derive from light" })
      );
    });

    expect(colorField(/^Background color/u).value).toBe("#000000");
    expect(colorField(/^Primary color/u).value).toBe(
      DERIVED_DARK_THEME.primaryColor
    );
  });

  it("adopts the dark palette the save stored", async () => {
    await renderForm(undefined, {
      darkAction: () =>
        Promise.resolve({
          darkTheme: SAVED_DARK_THEME,
          message: "The dark palette was saved.",
          ok: true,
        }),
    });
    await openTab("Dark");

    fireEvent.change(colorField(/^Primary color/u), {
      target: { value: "#8FB0F0" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save the dark palette" })
    );

    await waitFor(() => {
      expect(colorField(/^Primary color/u).value).toBe("#8fb0f0");
    }, onScreen);
  });

  it("shows why the dark palette could not be read, with no dark preview", async () => {
    const container = await renderForm(undefined, {
      darkTheme: {
        message: "Could not load the dark palette. Please try again later.",
        ok: false,
      },
    });

    await openTab("Dark");

    expect(screen.getByText("Could not display the dark palette")).toBeTruthy();
    expect(
      screen.queryByRole("textbox", { name: /Primary color/u })
    ).toBeNull();

    await openTab("Preview");
    expect(container.querySelectorAll(".publira-theme-scope")).toHaveLength(1);
  });
});
