import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCountAnnouncementAudience,
  mockCreateAnnouncement,
  mockDeleteAnnouncement,
  mockRedirect,
  mockUpdateAnnouncement,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockCountAnnouncementAudience: vi.fn(),
  mockCreateAnnouncement: vi.fn(),
  mockDeleteAnnouncement: vi.fn(),
  mockRedirect: vi.fn(),
  mockUpdateAnnouncement: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

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
  announcementsCacheTag: (tenantId: string) => `announcements-${tenantId}`,
  countAnnouncementAudience: mockCountAnnouncementAudience,
  createAnnouncement: mockCreateAnnouncement,
  deleteAnnouncement: mockDeleteAnnouncement,
  unpinAnnouncement: vi.fn(),
  updateAnnouncement: mockUpdateAnnouncement,
}));

vi.mock("#lib/locale", () => ({ getLocale: () => Promise.resolve("en") }));

vi.mock("#lib/auth-session", () => ({
  withAdminSessionReauth: <T>(run: () => Promise<T>) => run(),
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
        audience: null,
        deliverAt: "",
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

/** A form addressed to readers by conditions, each row's type and inputs as posted. */
const targetedFormData = (
  conditions: readonly [type: string, fields?: Record<string, string>][]
): FormData => {
  const formData = announcementFormData([
    { body: "New chapter today.", locale: "", title: "For followers" },
  ]);

  formData.set("audience", "targeted");

  for (const [type, fields = {}] of conditions) {
    formData.append("audience_condition", type);

    for (const [name, value] of Object.entries(fields)) {
      formData.set(name, value);
    }
  }

  return formData;
};

describe("createAnnouncementAction with an audience and a delivery time", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockCreateAnnouncement.mockResolvedValue({ ok: true });
  });

  it("sends every condition in the order the rows are on the form", async () => {
    const { createAnnouncementAction } = await import("./actions");

    await createAnnouncementAction(
      null,
      targetedFormData([
        ["follows_series", { audience_follows_series_series: " SERIES001 " }],
        ["locale", { audience_locale_locale: "ja" }],
        [
          "subscription",
          {
            audience_subscription_plan: "",
            audience_subscription_state: "ended",
          },
        ],
        ["last_read_days_ago", { audience_last_read_days_ago_days: "30" }],
        ["never_purchased"],
      ])
    );

    expect(mockCreateAnnouncement).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: [
          { seriesPublicId: "SERIES001", type: "follows_series" },
          { locale: "ja", type: "locale" },
          { planPublicId: "", state: "ended", type: "subscription" },
          { days: 30, type: "last_read_days_ago" },
          { type: "never_purchased" },
        ],
      }),
      "en"
    );
  });

  it("sends no audience when everyone is chosen, whatever rows were posted", async () => {
    const formData = targetedFormData([["never_purchased"]]);
    formData.set("audience", "everyone");

    const { createAnnouncementAction } = await import("./actions");
    await createAnnouncementAction(null, formData);

    expect(mockCreateAnnouncement).toHaveBeenCalledWith(
      expect.objectContaining({ audience: null }),
      "en"
    );
  });

  it.each([
    ["0", "last_read_days_ago"],
    ["3651", "signed_up_within_days"],
    ["1.5", "last_read_days_ago"],
  ])("refuses a day count of %s next to its condition", async (days, type) => {
    const { createAnnouncementAction } = await import("./actions");

    const state = await createAnnouncementAction(
      null,
      targetedFormData([[type, { [`audience_${type}_days`]: days }]])
    );

    expect(state).toEqual({
      fieldErrors: {
        [`audience.${type}`]: "Enter a number of days from 1 to 3650.",
      },
      message: "Enter a number of days from 1 to 3650.",
      ok: false,
    });
    expect(mockCreateAnnouncement).not.toHaveBeenCalled();
  });

  it("refuses a condition named twice", async () => {
    const { createAnnouncementAction } = await import("./actions");

    const state = await createAnnouncementAction(
      null,
      targetedFormData([["never_purchased"], ["never_purchased"]])
    );

    expect(state).toEqual({
      fieldErrors: { audience: "Each condition can be used only once." },
      message: "Each condition can be used only once.",
      ok: false,
    });
    expect(mockCreateAnnouncement).not.toHaveBeenCalled();
  });

  it("refuses a series condition that names no series", async () => {
    const { createAnnouncementAction } = await import("./actions");

    const state = await createAnnouncementAction(
      null,
      targetedFormData([["bought_series_episode"]])
    );

    expect(state).toMatchObject({
      fieldErrors: { "audience.bought_series_episode": "Choose a series." },
      ok: false,
    });
    expect(mockCreateAnnouncement).not.toHaveBeenCalled();
  });

  it("refuses a targeted audience with no condition", async () => {
    const { createAnnouncementAction } = await import("./actions");

    const state = await createAnnouncementAction(null, targetedFormData([]));

    expect(state).toMatchObject({
      fieldErrors: {
        audience:
          "Add at least one condition, or address the announcement to everyone.",
      },
      ok: false,
    });
  });

  it("refuses a targeted announcement sent to everyone or shown as a banner", async () => {
    const { createAnnouncementAction } = await import("./actions");
    const formData = targetedFormData([["has_mobile_push_device"]]);
    formData.set("pinned", "on");

    const state = await createAnnouncementAction(null, formData);

    expect(state).toMatchObject({
      fieldErrors: {
        audience:
          "An announcement with conditions cannot be sent to everyone or shown as a site banner.",
      },
      ok: false,
    });
    expect(mockCreateAnnouncement).not.toHaveBeenCalled();
  });

  it("sends the time the announcement goes out at", async () => {
    const deliverAt = Temporal.Now.instant()
      .add({ hours: 24 })
      .round("second")
      .toString();

    const formData = announcementFormData([
      { body: "Down from 22:00.", locale: "", title: "Maintenance" },
    ]);

    formData.set("deliver_at", deliverAt);

    const { createAnnouncementAction } = await import("./actions");
    await createAnnouncementAction(null, formData);

    expect(mockCreateAnnouncement).toHaveBeenCalledWith(
      expect.objectContaining({ deliverAt }),
      "en"
    );
  });

  it("refuses a delivery time that has passed next to the field", async () => {
    const formData = announcementFormData([
      { body: "Down from 22:00.", locale: "", title: "Maintenance" },
    ]);

    formData.set(
      "deliver_at",
      Temporal.Now.instant().subtract({ hours: 1 }).toString()
    );

    const { createAnnouncementAction } = await import("./actions");
    const state = await createAnnouncementAction(null, formData);

    expect(state).toEqual({
      fieldErrors: {
        deliverAt: "The announcement has to go out at a time in the future.",
      },
      message: "The announcement has to go out at a time in the future.",
      ok: false,
    });
    expect(mockCreateAnnouncement).not.toHaveBeenCalled();
  });

  it("refuses a banner that stops before the announcement goes out", async () => {
    const formData = announcementFormData([
      { body: "Down from 22:00.", locale: "", title: "Maintenance" },
    ]);

    const now = Temporal.Now.instant();
    formData.set("deliver_at", now.add({ hours: 48 }).toString());
    formData.set("pinned", "on");
    formData.set("pinned_until", now.add({ hours: 24 }).toString());

    const { createAnnouncementAction } = await import("./actions");
    const state = await createAnnouncementAction(null, formData);

    expect(state).toEqual({
      message: "The banner has to stop after the announcement goes out.",
      ok: false,
    });
    expect(mockCreateAnnouncement).not.toHaveBeenCalled();
  });
});

describe("updateAnnouncementAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockUpdateAnnouncement.mockResolvedValue({ ok: true });
  });

  it("saves the announcement it was opened for and goes back to the list", async () => {
    const formData = announcementFormData([
      { body: "Down from 22:00.", locale: "", title: "Maintenance" },
    ]);

    formData.set("announcement_id", "018f0f90-0001-7000-8000-000000000101");

    const { updateAnnouncementAction } = await import("./actions");
    await updateAnnouncementAction(null, formData);

    expect(mockUpdateAnnouncement).toHaveBeenCalledWith(
      expect.objectContaining({
        announcementId: "018f0f90-0001-7000-8000-000000000101",
        deliverAt: "",
        tenantId: "TENANT001",
      }),
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("announcements-TENANT001");
    expect(mockRedirect).toHaveBeenCalledWith("/announcements");
  });

  it("refuses a save that names no announcement", async () => {
    const { updateAnnouncementAction } = await import("./actions");

    const state = await updateAnnouncementAction(
      null,
      announcementFormData([
        { body: "Down from 22:00.", locale: "", title: "Maintenance" },
      ])
    );

    expect(state).toMatchObject({ ok: false });
    expect(mockUpdateAnnouncement).not.toHaveBeenCalled();
  });

  it("keeps the form and says why when the API refuses the save", async () => {
    mockUpdateAnnouncement.mockResolvedValue({
      message: "The announcement has already gone out.",
      ok: false,
    });

    const formData = announcementFormData([
      { body: "Down from 22:00.", locale: "", title: "Maintenance" },
    ]);

    formData.set("announcement_id", "018f0f90-0001-7000-8000-000000000101");

    const { updateAnnouncementAction } = await import("./actions");
    const state = await updateAnnouncementAction(null, formData);

    expect(state).toEqual({
      message: "The announcement has already gone out.",
      ok: false,
    });
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

describe("deleteAnnouncementAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockDeleteAnnouncement.mockResolvedValue({ ok: true });
  });

  it("deletes the announcement and goes back to the list", async () => {
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("announcement_id", "018f0f90-0001-7000-8000-000000000101");

    const { deleteAnnouncementAction } = await import("./actions");
    await deleteAnnouncementAction(null, formData);

    expect(mockDeleteAnnouncement).toHaveBeenCalledWith(
      {
        announcementId: "018f0f90-0001-7000-8000-000000000101",
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("announcements-TENANT001");
    expect(mockRedirect).toHaveBeenCalledWith("/announcements");
  });
});

describe("countAnnouncementAudienceAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockCountAnnouncementAudience.mockResolvedValue({
      ok: true,
      readerCount: 4,
    });
  });

  it("counts conditions the form's own schema takes", async () => {
    const { countAnnouncementAudienceAction } = await import("./actions");

    const result = await countAnnouncementAudienceAction({
      conditions: [
        { seriesPublicId: "SERIES001", type: "follows_series" },
        { days: 7, type: "signed_up_within_days" },
      ],
      tenantId: "TENANT001",
    });

    expect(result).toEqual({ ok: true, readerCount: 4 });
    expect(mockCountAnnouncementAudience).toHaveBeenCalledWith({
      audience: [
        { seriesPublicId: "SERIES001", type: "follows_series" },
        { days: 7, type: "signed_up_within_days" },
      ],
      tenantId: "TENANT001",
    });
  });

  it.each([
    [
      "a duplicate condition",
      [
        { locale: "en", type: "locale" },
        { locale: "ja", type: "locale" },
      ],
    ],
    ["a day count of 0", [{ days: 0, type: "last_read_days_ago" }]],
    ["no condition", []],
    ["something that is not a list", "never_purchased"],
  ])("counts nothing for %s", async (_label, conditions) => {
    const { countAnnouncementAudienceAction } = await import("./actions");

    await expect(
      countAnnouncementAudienceAction({ conditions, tenantId: "TENANT001" })
    ).resolves.toEqual({ ok: false });
    expect(mockCountAnnouncementAudience).not.toHaveBeenCalled();
  });
});
