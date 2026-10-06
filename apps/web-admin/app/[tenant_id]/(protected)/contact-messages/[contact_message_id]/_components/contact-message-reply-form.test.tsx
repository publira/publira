// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import type { FormActionState } from "@publira/ui-components/action-form";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContactMessageReplyForm } from "./contact-message-reply-form";

const reply =
  vi.fn<
    (
      previousState: FormActionState,
      formData: FormData
    ) => Promise<FormActionState>
  >();

// The Action is `"use server"`, so the module it lives in cannot be evaluated
// here at all.
vi.mock("../_lib/actions", () => ({
  replyToContactMessageAction: (
    previousState: FormActionState,
    formData: FormData
  ) => reply(previousState, formData),
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

const contactMessage = {
  entryCount: 0,
  id: "018f0f80-0003-7000-8000-000000000001",
  publicId: "CONTACT0001",
  replyToEmail: "reader@example.com",
};

const answerField = () =>
  screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Answer" });

const send = () => {
  fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
};

afterEach(() => {
  cleanup();
  reply.mockReset();
});

describe("ContactMessageReplyForm", () => {
  it("says where the answer goes, where the reader's reply comes back, and how long it may be", () => {
    render(
      <ContactMessageReplyForm
        contactMessage={contactMessage}
        tenantId="TENANT001"
      />
    );

    expect(
      screen.getByText(
        "The answer is mailed to reader@example.com and marks the message handled. When the reader writes back, the reply reaches your own account's email address. Up to 4000 characters."
      )
    ).toBeTruthy();
  });

  it("sends the answer for the message it sits under", async () => {
    reply.mockResolvedValue(null);
    render(
      <ContactMessageReplyForm
        contactMessage={contactMessage}
        tenantId="TENANT001"
      />
    );

    fireEvent.change(answerField(), {
      target: { value: "Every episode marked free." },
    });
    send();

    await waitFor(() => {
      expect(reply).toHaveBeenCalledTimes(1);
    });
    const [[, formData]] = reply.mock.calls;
    expect(Object.fromEntries(formData)).toEqual({
      body: "Every episode marked free.",
      contact_message_id: contactMessage.id,
      public_id: contactMessage.publicId,
      tenant_id: "TENANT001",
    });
  });

  // The Action carries the answer typed when the form was submitted, so an
  // edit made while it is in flight would be lost, and a second press would
  // send the answer twice.
  it("closes the field and the button while the answer is being sent", async () => {
    // React entangles pending async actions across roots, so the send is
    // settled before the test ends rather than left running into the next.
    const { promise, resolve } = Promise.withResolvers<FormActionState>();
    reply.mockReturnValue(promise);
    render(
      <ContactMessageReplyForm
        contactMessage={contactMessage}
        tenantId="TENANT001"
      />
    );
    fireEvent.change(answerField(), { target: { value: "An answer." } });

    send();

    await waitFor(() => {
      expect(answerField().matches(":disabled")).toBe(true);
    });
    const button = screen.getByRole("button", { name: "Sending…" });
    expect(button.matches(":disabled")).toBe(true);

    await act(() => {
      resolve(null);
    });
  });

  it("shows a refusal and keeps what was typed", async () => {
    reply.mockResolvedValue({
      message: "Could not send the answer. Please try again later.",
      ok: false,
    });
    render(
      <ContactMessageReplyForm
        contactMessage={contactMessage}
        tenantId="TENANT001"
      />
    );
    fireEvent.change(answerField(), { target: { value: "An answer." } });

    send();

    expect(
      await screen.findByText(
        "Could not send the answer. Please try again later."
      )
    ).toBeTruthy();
    expect(answerField().value).toBe("An answer.");
    expect(answerField().matches(":disabled")).toBe(false);
  });

  it("empties the field once the answer it held is read back as an entry", () => {
    const { rerender } = render(
      <ContactMessageReplyForm
        contactMessage={contactMessage}
        tenantId="TENANT001"
      />
    );
    fireEvent.change(answerField(), { target: { value: "An answer." } });

    rerender(
      <ContactMessageReplyForm
        contactMessage={{ ...contactMessage, entryCount: 1 }}
        tenantId="TENANT001"
      />
    );

    expect(answerField().value).toBe("");
  });
});
