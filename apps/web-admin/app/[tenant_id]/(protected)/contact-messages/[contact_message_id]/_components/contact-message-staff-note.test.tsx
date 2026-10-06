// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContactMessageStaffNote } from "./contact-message-staff-note";

vi.mock("../_lib/actions", () => ({
  updateContactMessageStaffNoteAction: () => Promise.resolve(null),
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

const withoutNote = {
  id: "018f0f80-0003-7000-8000-000000000001",
  publicId: "CONTACT0001",
  staffNote: "",
};

const withNote = {
  ...withoutNote,
  staffNote: "Asked the reader for their device.\nWaiting for an answer.",
};

/** What the staff note form would post. */
const submitted = () => {
  const form = screen
    .getByRole("button", { name: "Save note" })
    .closest("form");
  if (!form) {
    throw new Error('"Save note" submits no form');
  }
  return Object.fromEntries(new FormData(form));
};

const noteField = () =>
  screen.getByRole("textbox", { name: "Note" }) as HTMLTextAreaElement;

afterEach(() => {
  cleanup();
});

describe("ContactMessageStaffNote", () => {
  it("shows the current note, line breaks and all", () => {
    render(
      <ContactMessageStaffNote contactMessage={withNote} tenantId="TENANT001" />
    );

    expect(noteField().value).toBe(withNote.staffNote);
  });

  it("starts empty on a message nobody has written a note on", () => {
    render(
      <ContactMessageStaffNote
        contactMessage={withoutNote}
        tenantId="TENANT001"
      />
    );

    expect(noteField().value).toBe("");
  });

  it("saves the edited note for the message it sits on", () => {
    render(
      <ContactMessageStaffNote contactMessage={withNote} tenantId="TENANT001" />
    );

    fireEvent.change(noteField(), {
      target: { value: "The reader uses an old tablet." },
    });

    expect(submitted()).toEqual({
      contact_message_id: withoutNote.id,
      public_id: withoutNote.publicId,
      staff_note: "The reader uses an old tablet.",
      tenant_id: "TENANT001",
    });
  });

  it("clears the note by saving the field empty", () => {
    render(
      <ContactMessageStaffNote contactMessage={withNote} tenantId="TENANT001" />
    );

    fireEvent.change(noteField(), { target: { value: "" } });

    expect(submitted().staff_note).toBe("");
    expect(
      screen.getByText(
        "Saving replaces the note for everyone. Empty the field and save to clear it."
      )
    ).toBeTruthy();
  });

  it("takes up the note saved since, replacing what the field held", () => {
    const { rerender } = render(
      <ContactMessageStaffNote contactMessage={withNote} tenantId="TENANT001" />
    );
    fireEvent.change(noteField(), { target: { value: "An unsaved draft." } });

    rerender(
      <ContactMessageStaffNote
        contactMessage={{ ...withNote, staffNote: "Somebody else's note." }}
        tenantId="TENANT001"
      />
    );

    expect(noteField().value).toBe("Somebody else's note.");
  });
});
