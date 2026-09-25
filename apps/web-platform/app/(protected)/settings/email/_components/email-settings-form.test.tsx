// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlatformMessagesContextProvider } from "#components/platform-messages-context";
import type { PlatformSmtpSettings } from "#lib/email-settings-shared";
import { loadPlatformMessages } from "#lib/messages";

import type {
  PlatformEmailSettingsFormState,
  PlatformSmtpTestFormState,
} from "../../_lib/actions";
import { EmailSettingsForm } from "./email-settings-form";

const storedSettings: PlatformSmtpSettings = {
  encryption: "starttls",
  fromAddress: "mail@platform.example",
  hasPassword: true,
  host: "smtp.platform.example",
  port: 587,
  replyTo: "",
  revision: "1",
  username: "platform-user",
};

const renderForm = async ({
  testAction,
}: {
  testAction: (
    previousState: PlatformSmtpTestFormState,
    formData: FormData
  ) => Promise<PlatformSmtpTestFormState>;
}) => {
  const messages = loadPlatformMessages("en");

  await act(async () => {
    render(
      <Suspense fallback={null}>
        <PlatformMessagesContextProvider messages={messages}>
          <EmailSettingsForm
            initialSettings={storedSettings}
            saveAction={() =>
              Promise.resolve<PlatformEmailSettingsFormState>(null)
            }
            testAction={testAction}
          />
        </PlatformMessagesContextProvider>
      </Suspense>
    );
    await messages;
  });
};

afterEach(() => {
  cleanup();
});

describe("EmailSettingsForm", () => {
  // The test runs against what the form holds, saved or not, so an operator
  // who tests an edit and then saves it has to find the edit still there.
  it("keeps the typed settings once the connection test settles", async () => {
    const testAction = vi.fn(
      (_previousState: PlatformSmtpTestFormState, _formData: FormData) =>
        Promise.resolve<PlatformSmtpTestFormState>({
          message: "Test email sent.",
          ok: true,
          recipientEmail: "operator@platform.example",
        })
    );
    await renderForm({ testAction });

    const typed = [
      [/Host/u, "smtp.edited.example"],
      [/Port/u, "2525"],
      [/Username/u, "edited-user"],
      [/From address/u, "edited@platform.example"],
      [/Reply-to address/u, "support@platform.example"],
    ] as const;
    for (const [label, value] of typed) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send test" }));

    await screen.findByText("Test email sent.");
    expect(testAction.mock.calls[0]?.[1].get("host")).toBe(
      "smtp.edited.example"
    );
    for (const [label, value] of typed) {
      expect(screen.getByLabelText(label)).toHaveProperty("value", value);
    }
  });
});
