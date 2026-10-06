import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockRedirect,
  mockReplyToContactMessage,
  mockUpdateStaffNote,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockRedirect: vi.fn(),
  mockReplyToContactMessage: vi.fn(),
  mockUpdateStaffNote: vi.fn(),
}));

vi.mock("#lib/action-messages", () => ({
  getActionLocale: () => Promise.resolve("en"),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/auth-session", () => ({
  withAdminSessionReauth: (run: () => Promise<unknown>) => run(),
}));

vi.mock("#lib/contact-message", () => ({
  assignContactMessage: vi.fn(),
  markContactMessageHandled: vi.fn(),
  replyToContactMessage: mockReplyToContactMessage,
  updateContactMessageStaffNote: mockUpdateStaffNote,
}));

const contactMessageId = "018f0f80-0003-7000-8000-000000000001";

const staffNoteFormData = (staffNote: string) => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("contact_message_id", contactMessageId);
  formData.set("public_id", "CONTACT0001");
  formData.set("staff_note", staffNote);
  return formData;
};

const replyFormData = (body: string) => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("contact_message_id", contactMessageId);
  formData.set("public_id", "CONTACT0001");
  formData.set("body", body);
  return formData;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("updateContactMessageStaffNoteAction", () => {
  it("saves the note trimmed and returns to the message with the saved toast", async () => {
    mockUpdateStaffNote.mockResolvedValueOnce({ ok: true });

    const { updateContactMessageStaffNoteAction } = await import("./actions");
    await updateContactMessageStaffNoteAction(
      null,
      staffNoteFormData("  Asked the reader for their device.\n")
    );

    expect(mockAssertSameOrigin).toHaveBeenCalled();
    expect(mockUpdateStaffNote).toHaveBeenCalledWith(
      {
        contactMessageId,
        staffNote: "Asked the reader for their device.",
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockRedirect).toHaveBeenCalledWith(
      "/contact-messages/CONTACT0001?note_saved=1"
    );
  });

  it("clears the note when the field is emptied, with the cleared toast", async () => {
    mockUpdateStaffNote.mockResolvedValueOnce({ ok: true });

    const { updateContactMessageStaffNoteAction } = await import("./actions");
    await updateContactMessageStaffNoteAction(null, staffNoteFormData("  \n "));

    expect(mockUpdateStaffNote).toHaveBeenCalledWith(
      expect.objectContaining({ staffNote: "" }),
      "en"
    );
    expect(mockRedirect).toHaveBeenCalledWith(
      "/contact-messages/CONTACT0001?note_cleared=1"
    );
  });

  it("counts the limit in characters, not UTF-16 code units", async () => {
    mockUpdateStaffNote.mockResolvedValue({ ok: true });

    const { updateContactMessageStaffNoteAction } = await import("./actions");
    // 4000 characters, each two UTF-16 code units.
    await updateContactMessageStaffNoteAction(
      null,
      staffNoteFormData("😀".repeat(4000))
    );
    expect(mockUpdateStaffNote).toHaveBeenCalledTimes(1);

    const result = await updateContactMessageStaffNoteAction(
      null,
      staffNoteFormData("a".repeat(4001))
    );
    expect(result).toEqual({
      message: "Keep the note to 4000 characters or fewer.",
      ok: false,
    });
    expect(mockUpdateStaffNote).toHaveBeenCalledTimes(1);
  });

  it("refuses a form that does not say which message it is for", async () => {
    const formData = staffNoteFormData("A note.");
    formData.set("contact_message_id", "");

    const { updateContactMessageStaffNoteAction } = await import("./actions");
    const result = await updateContactMessageStaffNoteAction(null, formData);

    expect(result).toEqual({ message: expect.stringMatching(/./u), ok: false });
    expect(mockUpdateStaffNote).not.toHaveBeenCalled();
  });

  it("keeps the staff member on the form with the API's refusal", async () => {
    mockUpdateStaffNote.mockResolvedValueOnce({
      message: "Could not save the staff note. Please try again later.",
      ok: false,
    });

    const { updateContactMessageStaffNoteAction } = await import("./actions");
    const result = await updateContactMessageStaffNoteAction(
      null,
      staffNoteFormData("A note.")
    );

    expect(result).toEqual({
      message: "Could not save the staff note. Please try again later.",
      ok: false,
    });
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

describe("replyToContactMessageAction", () => {
  it("sends the answer trimmed and returns to the message with the sent toast", async () => {
    mockReplyToContactMessage.mockResolvedValueOnce({ ok: true });

    const { replyToContactMessageAction } = await import("./actions");
    await replyToContactMessageAction(
      null,
      replyFormData("\n  Every episode marked free.\nThe rest need a ticket.  ")
    );

    expect(mockAssertSameOrigin).toHaveBeenCalled();
    expect(mockReplyToContactMessage).toHaveBeenCalledWith(
      {
        body: "Every episode marked free.\nThe rest need a ticket.",
        contactMessageId,
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockRedirect).toHaveBeenCalledWith(
      "/contact-messages/CONTACT0001?replied=1"
    );
  });

  it("refuses an answer that is only whitespace", async () => {
    const { replyToContactMessageAction } = await import("./actions");
    const result = await replyToContactMessageAction(
      null,
      replyFormData("  \n ")
    );

    expect(result).toEqual({ message: "Write the answer.", ok: false });
    expect(mockReplyToContactMessage).not.toHaveBeenCalled();
  });

  it("counts the limit in characters, as the reader's form does", async () => {
    mockReplyToContactMessage.mockResolvedValue({ ok: true });

    const { replyToContactMessageAction } = await import("./actions");
    // 4000 characters, each two UTF-16 code units.
    await replyToContactMessageAction(null, replyFormData("😀".repeat(4000)));
    expect(mockReplyToContactMessage).toHaveBeenCalledTimes(1);

    const result = await replyToContactMessageAction(
      null,
      replyFormData("a".repeat(4001))
    );
    expect(result).toEqual({
      message: "Keep the answer to 4000 characters or fewer.",
      ok: false,
    });
    expect(mockReplyToContactMessage).toHaveBeenCalledTimes(1);
  });

  it("refuses a form that does not say which message it answers", async () => {
    const formData = replyFormData("An answer.");
    formData.set("contact_message_id", "");

    const { replyToContactMessageAction } = await import("./actions");
    const result = await replyToContactMessageAction(null, formData);

    expect(result).toEqual({ message: expect.stringMatching(/./u), ok: false });
    expect(mockReplyToContactMessage).not.toHaveBeenCalled();
  });

  it("keeps the staff member on the form with the API's refusal", async () => {
    mockReplyToContactMessage.mockResolvedValueOnce({
      message: "Could not send the answer. Please try again later.",
      ok: false,
    });

    const { replyToContactMessageAction } = await import("./actions");
    const result = await replyToContactMessageAction(
      null,
      replyFormData("An answer.")
    );

    expect(result).toEqual({
      message: "Could not send the answer. Please try again later.",
      ok: false,
    });
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
