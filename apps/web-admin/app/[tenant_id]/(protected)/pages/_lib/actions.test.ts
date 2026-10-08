import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockCreatePage,
  mockCreatePageTranslation,
  mockCreatePageVersion,
  mockDeletePageTranslation,
  mockPublishPageVersion,
  mockRedirect,
  mockUpdatePage,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockCreatePage: vi.fn(),
  mockCreatePageTranslation: vi.fn(),
  mockCreatePageVersion: vi.fn(),
  mockDeletePageTranslation: vi.fn(),
  mockPublishPageVersion: vi.fn(),
  mockRedirect: vi.fn(),
  mockUpdatePage: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("#lib/action-messages", () => ({
  getActionLocale: () => Promise.resolve("en"),
}));

vi.mock("next/cache", () => ({ updateTag: mockUpdateTag }));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/auth-session", () => ({
  withAdminSessionReauth: (run: () => Promise<unknown>) => run(),
}));

vi.mock("#lib/page", () => ({
  createPage: mockCreatePage,
  createPageTranslation: mockCreatePageTranslation,
  createPageVersion: mockCreatePageVersion,
  deletePageTranslation: mockDeletePageTranslation,
  pageCacheTag: (tenantId: string, pageId: string) =>
    `page-${tenantId}-${pageId}`,
  pagesCacheTag: (tenantId: string) => `pages-${tenantId}`,
  publishPageVersion: mockPublishPageVersion,
  rollbackPageVersion: vi.fn(),
  unpublishPage: vi.fn(),
  updatePage: mockUpdatePage,
}));

const TENANT_ID = "TENANT001";
const PAGE_ID = "PAGE001";

const saveForm = (values: {
  contentMarkdown: string;
  displayInFooter?: boolean;
  initialContentMarkdown: string;
  initialDisplayInFooter?: boolean;
  initialTitle: string;
  title: string;
}): FormData => {
  const data = new FormData();
  data.set("tenant_id", TENANT_ID);
  data.set("page_id", PAGE_ID);
  data.set("title", values.title);
  data.set("initial_title", values.initialTitle);
  data.set("content_markdown", values.contentMarkdown);
  data.set("initial_content_markdown", values.initialContentMarkdown);
  if (values.displayInFooter !== undefined) {
    data.set("display_in_footer", String(values.displayInFooter));
  }
  if (values.initialDisplayInFooter !== undefined) {
    data.set(
      "initial_display_in_footer",
      String(values.initialDisplayInFooter)
    );
  }
  return data;
};

const unchanged = {
  contentMarkdown: "# Privacy\n",
  initialContentMarkdown: "# Privacy\n",
  initialTitle: "Privacy policy",
  title: "Privacy policy",
};

const savePage = async (formData: FormData) => {
  const { savePageAction } = await import("./actions");
  return await savePageAction(null, formData);
};

describe("savePageAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockUpdatePage.mockResolvedValue({ ok: true, page: { id: PAGE_ID } });
    mockCreatePageVersion.mockResolvedValue({
      ok: true,
      version: { id: "VERSION002" },
    });
  });

  it("writes the title without adding a version when only the title changed", async () => {
    await savePage(saveForm({ ...unchanged, title: "Privacy notice" }));

    expect(mockUpdatePage).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: PAGE_ID,
        tenantId: TENANT_ID,
        title: "Privacy notice",
      }),
      "en"
    );
    expect(mockCreatePageVersion).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith(`/pages/${PAGE_ID}?saved=1`);
  });

  it("adds a version without updating the page when only the body changed", async () => {
    await savePage(
      saveForm({ ...unchanged, contentMarkdown: "# Privacy\n\nRevised.\n" })
    );

    expect(mockUpdatePage).not.toHaveBeenCalled();
    expect(mockCreatePageVersion).toHaveBeenCalledWith(
      {
        contentMarkdown: "# Privacy\n\nRevised.\n",
        pageId: PAGE_ID,
        tenantId: TENANT_ID,
      },
      "en"
    );
    expect(mockRedirect).toHaveBeenCalledWith(`/pages/${PAGE_ID}?saved=1`);
  });

  it("writes both halves in one submission", async () => {
    await savePage(
      saveForm({
        ...unchanged,
        contentMarkdown: "# Privacy\n\nRevised.\n",
        title: "Privacy notice",
      })
    );

    expect(mockUpdatePage).toHaveBeenCalledTimes(1);
    expect(mockCreatePageVersion).toHaveBeenCalledTimes(1);
  });

  it("writes to the translation the screen is showing and returns to it", async () => {
    const data = saveForm({
      ...unchanged,
      contentMarkdown: "# Privacy\n\nRevised.\n",
      title: "Privacy notice",
    });
    data.set("translation_locale", "en");

    await savePage(data);

    expect(mockUpdatePage).toHaveBeenCalledWith(
      expect.objectContaining({ translationLocale: "en" }),
      "en"
    );
    expect(mockCreatePageVersion).toHaveBeenCalledWith(
      expect.objectContaining({ translationLocale: "en" }),
      "en"
    );
    expect(mockRedirect).toHaveBeenCalledWith(
      `/pages/${PAGE_ID}?locale=en&saved=1`
    );
  });

  it("refuses a translation locale the console does not serve", async () => {
    const data = saveForm({ ...unchanged, title: "Privacy notice" });
    data.set("translation_locale", "fr");

    const state = await savePage(data);

    expect(mockUpdatePage).not.toHaveBeenCalled();
    expect(state).toEqual({
      message: "Choose a supported language.",
      ok: false,
    });
  });

  it("writes nothing when neither half changed", async () => {
    await savePage(saveForm(unchanged));

    expect(mockUpdatePage).not.toHaveBeenCalled();
    expect(mockCreatePageVersion).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith(`/pages/${PAGE_ID}?saved=1`);
  });

  // Someone else may have renamed the translation since this screen loaded,
  // and the title it loaded would put the old one back.
  it.each([true, false])(
    "writes Show in footer as %s without the title or a version when only it changed",
    async (displayInFooter) => {
      await savePage(
        saveForm({
          ...unchanged,
          displayInFooter,
          initialDisplayInFooter: !displayInFooter,
        })
      );

      expect(mockUpdatePage).toHaveBeenCalledWith(
        expect.objectContaining({
          displayInFooter,
          pageId: PAGE_ID,
          title: undefined,
        }),
        "en"
      );
      expect(mockCreatePageVersion).not.toHaveBeenCalled();
      expect(mockRedirect).toHaveBeenCalledWith(`/pages/${PAGE_ID}?saved=1`);
    }
  );

  // Another language tab may have changed it since this one loaded, and an
  // unchanged box would put the old value back.
  it("leaves Show in footer out of a save that did not change it", async () => {
    await savePage(
      saveForm({
        ...unchanged,
        displayInFooter: true,
        initialDisplayInFooter: true,
        title: "Privacy notice",
      })
    );

    expect(mockUpdatePage).toHaveBeenCalledWith(
      expect.objectContaining({ displayInFooter: undefined }),
      "en"
    );
  });

  it("writes nothing when Show in footer is as it was loaded", async () => {
    await savePage(
      saveForm({
        ...unchanged,
        displayInFooter: false,
        initialDisplayInFooter: false,
      })
    );

    expect(mockUpdatePage).not.toHaveBeenCalled();
  });

  it("leaves the body alone when the title could not be saved, and says so", async () => {
    mockUpdatePage.mockResolvedValueOnce({
      message: "Could not save the page. Please try again later.",
      ok: false,
    });

    const state = await savePage(
      saveForm({
        ...unchanged,
        contentMarkdown: "# Privacy\n\nRevised.\n",
        title: "Privacy notice",
      })
    );

    expect(mockCreatePageVersion).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(state?.message).toBe(
      "The title and Show in footer could not be saved, so the content was not saved either. Could not save the page. Please try again later."
    );
  });

  it("reports that the title was saved when only the body failed", async () => {
    mockCreatePageVersion.mockResolvedValueOnce({
      message: "Could not save the page. Please try again later.",
      ok: false,
    });

    const state = await savePage(
      saveForm({
        ...unchanged,
        contentMarkdown: "# Privacy\n\nRevised.\n",
        title: "Privacy notice",
      })
    );

    expect(mockUpdatePage).toHaveBeenCalledTimes(1);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(state?.message).toBe(
      "The title and Show in footer were saved, but the content could not be saved as a new draft version. Could not save the page. Please try again later."
    );
  });

  it("names only the body when the title was not part of the save", async () => {
    mockCreatePageVersion.mockResolvedValueOnce({
      message: "Could not save the page. Please try again later.",
      ok: false,
    });

    const state = await savePage(
      saveForm({ ...unchanged, contentMarkdown: "# Privacy\n\nRevised.\n" })
    );

    expect(state?.message).toBe(
      "The content could not be saved as a new draft version. Could not save the page. Please try again later."
    );
  });
});

const createForm = (): FormData => {
  const data = new FormData();
  data.set("tenant_id", TENANT_ID);
  data.set("slug", "/login");
  data.set("title", "Help");
  return data;
};

describe("createPageAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("puts a slug failure on the slug field", async () => {
    mockCreatePage.mockResolvedValueOnce({
      field: "slug",
      message: "The site keeps this path.",
      ok: false,
    });

    const { createPageAction } = await import("./actions");
    const state = await createPageAction(null, createForm());

    expect(state).toEqual({
      fieldErrors: { slug: "The site keeps this path." },
      message: "Please check the information you entered.",
      ok: false,
    });
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

describe("createPageAction's first version", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockCreatePage.mockResolvedValue({
      ok: true,
      page: { id: PAGE_ID, locale: "ja" },
    });
    mockCreatePageVersion.mockResolvedValue({
      ok: true,
      version: { id: "VERSION001" },
    });
  });

  it("goes into the translation the page was created with", async () => {
    const data = createForm();
    data.set("content_markdown", "# Help\n");

    const { createPageAction } = await import("./actions");
    await createPageAction(null, data);

    expect(mockCreatePageVersion).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: PAGE_ID, translationLocale: "ja" }),
      "en"
    );
    expect(mockRedirect).toHaveBeenCalledWith(
      `/pages/${PAGE_ID}?locale=ja&created=1`
    );
  });
});

describe("publishVersionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockPublishPageVersion.mockResolvedValue({
      ok: true,
      version: { id: "VERSION002" },
    });
  });

  it("publishes within the translation the version belongs to", async () => {
    const data = new FormData();
    data.set("tenant_id", TENANT_ID);
    data.set("page_id", PAGE_ID);
    data.set("version_id", "VERSION002");
    data.set("translation_locale", "en");

    const { publishVersionAction } = await import("./actions");
    await publishVersionAction(data);

    expect(mockPublishPageVersion).toHaveBeenCalledWith(
      {
        pageId: PAGE_ID,
        tenantId: TENANT_ID,
        translationLocale: "en",
        versionId: "VERSION002",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(`pages-${TENANT_ID}`);
    expect(mockUpdateTag).toHaveBeenCalledWith(`page-${TENANT_ID}-${PAGE_ID}`);
    expect(mockRedirect).toHaveBeenCalledWith(
      `/pages/${PAGE_ID}?locale=en&published=1`
    );
  });
});

const translationForm = (values: Record<string, string>): FormData => {
  const data = new FormData();
  data.set("tenant_id", TENANT_ID);
  data.set("page_id", PAGE_ID);
  for (const [name, value] of Object.entries(values)) {
    data.set(name, value);
  }
  return data;
};

describe("addPageTranslationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockCreatePageTranslation.mockResolvedValue({
      ok: true,
      translation: { id: "TRANSLATION002", locale: "en" },
    });
  });

  it("adds the translation and opens it", async () => {
    const { addPageTranslationAction } = await import("./actions");
    await addPageTranslationAction(
      null,
      translationForm({ title: " Privacy policy ", translation_locale: "en" })
    );

    expect(mockCreatePageTranslation).toHaveBeenCalledWith(
      {
        pageId: PAGE_ID,
        tenantId: TENANT_ID,
        title: "Privacy policy",
        translationLocale: "en",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(`pages-${TENANT_ID}`);
    expect(mockUpdateTag).toHaveBeenCalledWith(`page-${TENANT_ID}-${PAGE_ID}`);
    expect(mockRedirect).toHaveBeenCalledWith(
      `/pages/${PAGE_ID}?locale=en&translation_added=1`
    );
  });

  it("asks for a title before sending anything", async () => {
    const { addPageTranslationAction } = await import("./actions");
    const state = await addPageTranslationAction(
      null,
      translationForm({ title: "  ", translation_locale: "en" })
    );

    expect(mockCreatePageTranslation).not.toHaveBeenCalled();
    expect(state).toEqual({ message: "Title is required.", ok: false });
  });

  it("reports what the server refused", async () => {
    mockCreatePageTranslation.mockResolvedValueOnce({
      message:
        "This page already has a translation in that language. Reload the page.",
      ok: false,
    });

    const { addPageTranslationAction } = await import("./actions");
    const state = await addPageTranslationAction(
      null,
      translationForm({ title: "Privacy policy", translation_locale: "en" })
    );

    expect(mockRedirect).not.toHaveBeenCalled();
    expect(state).toEqual({
      message:
        "This page already has a translation in that language. Reload the page.",
      ok: false,
    });
  });
});

describe("deletePageTranslationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockDeletePageTranslation.mockResolvedValue({ ok: true });
  });

  it("deletes the translation and returns to the page's default one", async () => {
    const { deletePageTranslationAction } = await import("./actions");
    await deletePageTranslationAction(
      null,
      translationForm({ translation_locale: "en" })
    );

    expect(mockDeletePageTranslation).toHaveBeenCalledWith(
      { pageId: PAGE_ID, tenantId: TENANT_ID, translationLocale: "en" },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(`pages-${TENANT_ID}`);
    expect(mockUpdateTag).toHaveBeenCalledWith(`page-${TENANT_ID}-${PAGE_ID}`);
    expect(mockRedirect).toHaveBeenCalledWith(
      `/pages/${PAGE_ID}?translation_deleted=1`
    );
  });

  it("reports the refusal to delete the last translation", async () => {
    mockDeletePageTranslation.mockResolvedValueOnce({
      message:
        "A page keeps at least one translation, so its last one cannot be deleted.",
      ok: false,
    });

    const { deletePageTranslationAction } = await import("./actions");
    const state = await deletePageTranslationAction(
      null,
      translationForm({ translation_locale: "ja" })
    );

    expect(mockRedirect).not.toHaveBeenCalled();
    expect(state).toEqual({
      message:
        "A page keeps at least one translation, so its last one cannot be deleted.",
      ok: false,
    });
  });
});
