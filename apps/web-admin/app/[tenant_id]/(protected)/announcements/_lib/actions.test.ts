import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateAnnouncement, mockRedirect, mockUpdateTag } = vi.hoisted(
  () => ({
    mockCreateAnnouncement: vi.fn(),
    mockRedirect: vi.fn(),
    mockUpdateTag: vi.fn(),
  })
);

vi.mock("#lib/action-messages", () => ({
  getActionLocale: () => Promise.resolve("en"),
}));

vi.mock("#lib/messages", async () => {
  const { bindMessages } = await import("@publira/i18n");
  const { sharedCatalog } = await import("@publira/i18n/catalog");
  return {
    getMessagesFor: () =>
      Promise.resolve(bindMessages(sharedCatalog("en"), "en")),
  };
});

vi.mock("#lib/announcement", () => ({
  createAnnouncement: mockCreateAnnouncement,
  unpinAnnouncement: vi.fn(),
}));

vi.mock("#lib/auth-session", () => ({
  withAdminSessionReauth: (run: () => Promise<unknown>) => run(),
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: vi.fn() }));

vi.mock("#lib/tenant-timezone", () => ({
  getTenantDisplayTimeZone: () => Promise.resolve("UTC"),
}));

vi.mock("next/cache", () => ({ updateTag: mockUpdateTag }));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

/** One tab's fields, in the order the form posts them. */
interface Tab {
  locale: string;
  title: string;
  body: string;
}

const announcementFormData = (tabs: readonly Tab[]): FormData => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("link_url", "");
  for (const { body, locale, title } of tabs) {
    formData.append("translation_locale", locale);
    formData.append("title", title);
    formData.append("body", body);
  }
  return formData;
};

// Evaluating the Actions' module graph for the first time takes far longer than
// any test's own work, so it is paid here rather than inside one test's timeout.
beforeAll(async () => {
  await import("./actions");
});

describe("createAnnouncementAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockCreateAnnouncement.mockResolvedValue({ ok: true });
  });

  it("sends every language written in once, and leaves out a tab left empty", async () => {
    const { createAnnouncementAction } = await import("./actions");
    await createAnnouncementAction(
      null,
      announcementFormData([
        { body: " Down from 22:00. ", locale: "", title: " Maintenance " },
        { body: "", locale: "ko", title: "" },
        { body: "Japanese body", locale: "ja", title: "Japanese title" },
      ])
    );

    expect(mockCreateAnnouncement).toHaveBeenCalledTimes(1);
    expect(mockCreateAnnouncement).toHaveBeenCalledWith(
      {
        delivery: "preferred",
        linkUrl: "",
        pinned: false,
        pinnedUntil: "",
        tenantId: "TENANT001",
        translations: [
          { body: "Down from 22:00.", locale: "", title: "Maintenance" },
          { body: "Japanese body", locale: "ja", title: "Japanese title" },
        ],
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("announcements-TENANT001");
    expect(mockRedirect).toHaveBeenCalledWith("/announcements");
  });

  it("sends an announcement to everyone when the checkbox is on", async () => {
    const formData = announcementFormData([
      { body: "The terms change on July 1.", locale: "", title: "New terms" },
    ]);
    formData.set("delivery", "everyone");

    const { createAnnouncementAction } = await import("./actions");
    await createAnnouncementAction(null, formData);

    expect(mockCreateAnnouncement).toHaveBeenCalledWith(
      expect.objectContaining({ delivery: "everyone" }),
      "en"
    );
  });

  it("refuses an announcement whose default language has no title, even with another language written", async () => {
    const { createAnnouncementAction } = await import("./actions");
    const state = await createAnnouncementAction(
      null,
      announcementFormData([
        { body: "Down from 22:00.", locale: "", title: "  " },
        { body: "Japanese body", locale: "ja", title: "Japanese title" },
      ])
    );

    expect(state).toEqual({ message: "The title is required.", ok: false });
    expect(mockCreateAnnouncement).not.toHaveBeenCalled();
  });

  it("refuses an announcement whose default language has no body", async () => {
    const { createAnnouncementAction } = await import("./actions");
    const state = await createAnnouncementAction(
      null,
      announcementFormData([{ body: "", locale: "", title: "Maintenance" }])
    );

    expect(state).toEqual({ message: "The body is required.", ok: false });
    expect(mockCreateAnnouncement).not.toHaveBeenCalled();
  });

  it("refuses a language with a title and no body, naming the language", async () => {
    const { createAnnouncementAction } = await import("./actions");
    const state = await createAnnouncementAction(
      null,
      announcementFormData([
        { body: "Down from 22:00.", locale: "", title: "Maintenance" },
        { body: "", locale: "ja", title: "Japanese title" },
      ])
    );

    expect(state).toEqual({
      message: "Enter both a title and a body in 日本語, or leave both empty.",
      ok: false,
    });
    expect(mockCreateAnnouncement).not.toHaveBeenCalled();
  });

  it("refuses a language this build serves no catalog for", async () => {
    const { createAnnouncementAction } = await import("./actions");
    const state = await createAnnouncementAction(
      null,
      announcementFormData([
        { body: "Down from 22:00.", locale: "", title: "Maintenance" },
        { body: "Body", locale: "xx", title: "Title" },
      ])
    );

    expect(state).toEqual({
      message: "Choose a supported language.",
      ok: false,
    });
    expect(mockCreateAnnouncement).not.toHaveBeenCalled();
  });
});
