import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAssertSameOrigin, mockRedirect, mockUpdateStaffNote } = vi.hoisted(
  () => ({
    mockAssertSameOrigin: vi.fn(),
    mockRedirect: vi.fn(),
    mockUpdateStaffNote: vi.fn(),
  })
);

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
