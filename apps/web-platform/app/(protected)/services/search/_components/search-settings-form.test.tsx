// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MessageProps } from "#components/message";
import { PlatformMessagesContextProvider } from "#components/platform-messages-context";
import { getMessagesFor, loadPlatformMessages } from "#lib/messages";
import type { PlatformMessageAccessor } from "#lib/messages";
import {
  SEARCH_PASSWORD_REPLACE,
  SEARCH_PASSWORD_UNCHANGED,
} from "#lib/search-settings-shared";
import type { PlatformSearchSettings } from "#lib/search-settings-shared";

import { SearchSettingsForm } from "./search-settings-form";

const state = vi.hoisted(() => ({
  t: undefined as PlatformMessageAccessor | undefined,
}));

// `<Message>` is an async Server Component that only the Next.js compiler can
// render. The catalog is the real one, resolved ahead so the tree renders
// without suspending.
vi.mock("#components/message", () => ({
  Message: ({ message, values }: MessageProps) => state.t?.(message, values),
}));

const actions = vi.hoisted(() => ({
  testPlatformSearchConnectionAction: vi.fn(),
  updatePlatformSearchSettingsAction: vi.fn(),
}));

vi.mock("../_lib/actions", () => actions);

const storedSettings: PlatformSearchSettings = {
  buildFailure: null,
  buildState: "serving",
  engine: "opensearch",
  hasPassword: true,
  index: "publira-catalog",
  revision: "3",
  serving: {
    engine: "opensearch",
    index: "publira-catalog",
    revision: "3",
    since: "2026-10-01T00:00:00Z",
    url: "https://search.example.com",
  },
  url: "https://search.example.com",
  username: "publira",
};

const messages = loadPlatformMessages("en");

const withMessages = (children: ReactNode) => (
  <Suspense fallback={null}>
    <PlatformMessagesContextProvider messages={messages}>
      {children}
    </PlatformMessagesContextProvider>
  </Suspense>
);

const renderForm = async (settings: PlatformSearchSettings) => {
  let rendered: ReturnType<typeof render> | undefined;
  await act(async () => {
    rendered = render(withMessages(<SearchSettingsForm settings={settings} />));
    await messages;
  });
  if (!rendered) {
    throw new Error("The form did not render.");
  }
  return rendered;
};

/** The form data the last call of `action` was submitted with. */
const submitted = (action: ReturnType<typeof vi.fn>): FormData => {
  const formData = action.mock.calls.at(-1)?.[1];
  if (!(formData instanceof FormData)) {
    throw new TypeError("The action was not submitted.");
  }
  return formData;
};

beforeEach(async () => {
  state.t = await getMessagesFor("en");
  actions.updatePlatformSearchSettingsAction.mockResolvedValue({
    message: "Search settings saved.",
    ok: true,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("SearchSettingsForm", () => {
  it("never shows the stored password, and a save that leaves it alone keeps it", async () => {
    await renderForm(storedSettings);

    expect(screen.getByText("Saved (hidden)")).toBeTruthy();
    expect(screen.queryByLabelText(/^Password/u)).toBeNull();
    expect(screen.getByRole("textbox", { name: /^Username/u })).toHaveProperty(
      "value",
      "publira"
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Save search settings" })
    );
    await screen.findByText("Search settings saved.");

    const formData = submitted(actions.updatePlatformSearchSettingsAction);
    expect(formData.get("engine")).toBe("opensearch");
    expect(formData.get("credential_mode")).toBe("basic");
    expect(formData.get("password_update_mode")).toBe(
      String(SEARCH_PASSWORD_UNCHANGED)
    );
    expect(formData.get("password")).toBeNull();
  });

  it("asks for a new password, and sends it, only once the operator replaces the credential", async () => {
    await renderForm(storedSettings);

    fireEvent.click(
      screen.getByRole("button", { name: "Replace credentials" })
    );
    fireEvent.change(screen.getByLabelText(/^Password/u), {
      target: { value: "n3w-s3cret" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save search settings" })
    );
    await screen.findByText("Search settings saved.");

    const formData = submitted(actions.updatePlatformSearchSettingsAction);
    expect(formData.get("password_update_mode")).toBe(
      String(SEARCH_PASSWORD_REPLACE)
    );
    expect(formData.get("password")).toBe("n3w-s3cret");
  });

  it("leaves nothing to fill in or test once PostgreSQL is chosen", async () => {
    await renderForm(storedSettings);
    expect(screen.getByLabelText(/^URL/u)).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "PostgreSQL" }));

    expect(screen.queryByLabelText(/^URL/u)).toBeNull();
    expect(screen.queryByText("Authentication")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Test connection" })
    ).toBeNull();
  });

  it("offers a new engine's fields empty, with no authentication", async () => {
    await renderForm({
      ...storedSettings,
      engine: "sql",
      hasPassword: false,
      index: "",
      url: "",
      username: "",
    });
    expect(screen.queryByLabelText(/^URL/u)).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Elasticsearch" }));

    expect(screen.getByLabelText(/^URL/u)).toHaveProperty("value", "");
    expect(
      screen.getByRole("radio", { name: "No authentication" })
    ).toHaveProperty("ariaChecked", "true");
  });

  it("names the plugin a tested engine is missing", async () => {
    actions.testPlatformSearchConnectionAction.mockResolvedValue({
      message:
        "The engine is missing a plugin the catalog index needs: analysis-icu. Install it on every node and test again.",
      ok: false,
      result: {
        failure:
          "The engine is missing a plugin the catalog index needs: analysis-icu. Install it on every node and test again.",
        icuInstalled: false,
        kuromojiInstalled: true,
        product: "OpenSearch",
        succeeded: false,
        version: "3.2.0",
      },
    });
    await renderForm(storedSettings);

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    const results = await screen.findByRole("list", {
      name: "Connection test results",
    });
    expect(
      within(results)
        .getAllByRole("listitem")
        .map((item) => item.textContent)
    ).toEqual([
      "Engine: OpenSearch 3.2.0",
      "analysis-kuromoji: Installed",
      "analysis-icu: Missing",
    ]);
    expect(
      screen.getByText(
        /missing a plugin the catalog index needs: analysis-icu/u
      )
    ).toBeTruthy();
  });

  // A save refreshes the page with the settings it wrote, which reach the
  // mounted form as new defaults.
  it("shows the saved settings without changing a mounted field's default", async () => {
    const consoleError = vi.spyOn(console, "error");
    const { rerender } = await renderForm(storedSettings);

    rerender(
      withMessages(
        <SearchSettingsForm
          settings={{
            ...storedSettings,
            revision: "4",
            url: "https://search-2.example.com",
          }}
        />
      )
    );

    expect(screen.getByLabelText(/^URL/u)).toHaveProperty(
      "value",
      "https://search-2.example.com"
    );
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("Base UI")
    );
  });
});
