// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MessageProps } from "#components/message";
import { PlatformMessagesContextProvider } from "#components/platform-messages-context";
import { getMessagesFor, loadPlatformMessages } from "#lib/messages";
import type { PlatformMessageAccessor } from "#lib/messages";
import type { PlatformStorageSettings } from "#lib/storage-settings-shared";

import { StorageSettingsForm } from "./storage-settings-form";

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
  testPlatformStorageConnectionAction: vi.fn(),
  updatePlatformStorageSettingsAction: vi.fn(),
}));

vi.mock("../_lib/actions", () => actions);

const storedSettings: PlatformStorageSettings = {
  accessKeyId: "",
  bucket: "publira-media",
  endpoint: "",
  forcePathStyle: false,
  hasSecretAccessKey: false,
  publicBaseUrl: "https://media.platform.example",
  region: "us-east-1",
  revision: "1",
};

const messages = loadPlatformMessages("en");

const withMessages = (children: ReactNode) => (
  <Suspense fallback={null}>
    <PlatformMessagesContextProvider messages={messages}>
      {children}
    </PlatformMessagesContextProvider>
  </Suspense>
);

const renderForm = async (settings: PlatformStorageSettings) => {
  let rendered: ReturnType<typeof render> | undefined;
  await act(async () => {
    rendered = render(
      withMessages(<StorageSettingsForm settings={settings} />)
    );
    await messages;
  });
  if (!rendered) {
    throw new Error("The form did not render.");
  }
  return rendered;
};

beforeEach(async () => {
  state.t = await getMessagesFor("en");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("StorageSettingsForm", () => {
  it("keeps what the operator typed when the save is refused", async () => {
    actions.updatePlatformStorageSettingsAction.mockResolvedValue({
      message: "Could not save.",
      ok: false,
    });
    await renderForm(storedSettings);

    fireEvent.change(screen.getByLabelText(/Public base URL/u), {
      target: { value: "https://cdn.platform.example" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save storage settings" })
    );

    await screen.findByText("Could not save.");
    expect(screen.getByLabelText(/Public base URL/u)).toHaveProperty(
      "value",
      "https://cdn.platform.example"
    );
  });

  // A save refreshes the page with the settings it wrote, which reach the
  // mounted form as new defaults.
  it("shows the saved settings without changing a mounted field's default", async () => {
    const consoleError = vi.spyOn(console, "error");
    const { rerender } = await renderForm(storedSettings);

    rerender(
      withMessages(
        <StorageSettingsForm
          settings={{
            ...storedSettings,
            forcePathStyle: true,
            publicBaseUrl: "https://cdn.platform.example",
            revision: "2",
          }}
        />
      )
    );

    expect(screen.getByLabelText(/Public base URL/u)).toHaveProperty(
      "value",
      "https://cdn.platform.example"
    );
    expect(
      screen.getByRole("checkbox", { name: /Use path-style addressing/u })
    ).toHaveProperty("ariaChecked", "true");
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("Base UI")
    );
  });
});
