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

import { ChangeBirthDateButton } from "./change-birth-date-button";

const { save } = vi.hoisted(() => ({
  save: { current: Promise.withResolvers<FormActionState>() },
}));

vi.mock("../_lib/actions", () => ({
  setReaderBirthDateAction: () => save.current.promise,
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

afterEach(() => {
  cleanup();
  save.current = Promise.withResolvers<FormActionState>();
});

describe("ChangeBirthDateButton", () => {
  // The date is typed into the dialog, so reopening it while the save is in
  // flight would offer to change the value that save already carries.
  it("closes the dialog's trigger while the new date is being saved", async () => {
    render(
      <ChangeBirthDateButton
        birthDate="2000-01-01"
        name="Ada Lovelace"
        publicId="READER001"
        tenantId="TENANT001"
      />
    );
    const trigger = screen.getByRole("button", { name: "Change" });

    fireEvent.click(trigger);
    fireEvent.change(await screen.findByLabelText("Birth date"), {
      target: { value: "2010-05-05" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(trigger.matches(":disabled")).toBe(true);
    });

    save.current.resolve({ message: "Could not save.", ok: false });
    await waitFor(() => {
      expect(trigger.matches(":disabled")).toBe(false);
    });
  });

  // Enter in the date field submits the form without closing the dialog, so
  // the field itself stays in front of the operator.
  it("closes the date field while a save submitted from it is in flight", async () => {
    render(
      <ChangeBirthDateButton
        birthDate="2000-01-01"
        name="Ada Lovelace"
        publicId="READER001"
        tenantId="TENANT001"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const field = await screen.findByLabelText<HTMLInputElement>("Birth date");
    fireEvent.change(field, { target: { value: "2010-05-05" } });
    const { form } = field;
    if (!form) {
      throw new Error("the date field belongs to no form");
    }
    fireEvent.submit(form);

    await waitFor(() => {
      expect(field.disabled).toBe(true);
    });

    save.current.resolve({ message: "Could not save.", ok: false });
    await waitFor(() => {
      expect(field.disabled).toBe(false);
    });
  });
});
