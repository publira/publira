// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FormActionState } from "#components/action-form";
import { emptyTenantFcmSettings } from "#lib/fcm-settings";

import { FcmCredentialsForm } from "./fcm-credentials-form";

const { save } = vi.hoisted(() => ({
  save: { current: Promise.withResolvers<FormActionState>() },
}));

vi.mock("../_lib/actions", () => ({
  saveFcmCredentialsAction: () => save.current.promise,
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
}));

// Deleting the credentials is a form of its own.
vi.mock("./fcm-credentials-delete-button", () => ({
  FcmCredentialsDeleteButton: () => null,
}));

const fields = () => [
  screen.getByRole("textbox", { name: /Firebase project ID/u }),
  screen.getByLabelText(/Service account key file/u),
];

afterEach(() => {
  cleanup();
  save.current = Promise.withResolvers<FormActionState>();
});

describe("FcmCredentialsForm", () => {
  // The Action carries what the form held when it was submitted, so a change
  // made while it is in flight would sit under the success message unsaved.
  it("closes the credentials while their save is in flight", async () => {
    render(
      <FcmCredentialsForm
        locale="en"
        settings={emptyTenantFcmSettings}
        tenantId="TENANT001"
        timeZone="UTC"
      />
    );

    for (const field of fields()) {
      expect(field.matches(":disabled")).toBe(false);
    }

    // jsdom cannot hand a file input a file its validation sees, so the form is
    // submitted past the check a browser would pass once a key file is chosen.
    const { form } = screen.getByRole<HTMLButtonElement>("button", {
      name: "Save the credentials",
    });
    if (!form) {
      throw new Error("the save button belongs to no form");
    }
    fireEvent.submit(form);

    await waitFor(() => {
      for (const field of fields()) {
        expect(field.matches(":disabled")).toBe(true);
      }
    });

    save.current.resolve({ message: "Could not save.", ok: false });
    await waitFor(() => {
      expect(fields()[0].matches(":disabled")).toBe(false);
    });
  });
});
