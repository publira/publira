import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockCreatePage,
  mockCreatePageVersion,
  mockRedirect,
  mockUpdatePage,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockCreatePage: vi.fn(),
  mockCreatePageVersion: vi.fn(),
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
  createPageVersion: mockCreatePageVersion,
  publishPageVersion: vi.fn(),
  rollbackPageVersion: vi.fn(),
  unpublishPage: vi.fn(),
  updatePage: mockUpdatePage,
}));

const TENANT_ID = "TENANT001";
const PAGE_ID = "PAGE001";

const saveForm = (values: {
  contentMarkdown: string;
  initialContentMarkdown: string;
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

  it("writes nothing when neither half changed", async () => {
    await savePage(saveForm(unchanged));

    expect(mockUpdatePage).not.toHaveBeenCalled();
    expect(mockCreatePageVersion).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith(`/pages/${PAGE_ID}?saved=1`);
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
      "The title could not be saved, so the content was not saved either. Could not save the page. Please try again later."
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
      "The title was saved, but the content could not be saved as a new draft version. Could not save the page. Please try again later."
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

  it("keeps the field a slug failure belongs to", async () => {
    mockCreatePage.mockResolvedValueOnce({
      field: "slug",
      message: "The site keeps this path.",
      ok: false,
    });

    const { createPageAction } = await import("./actions");
    const state = await createPageAction(null, createForm());

    expect(state).toEqual({
      field: "slug",
      message: "The site keeps this path.",
      ok: false,
    });
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
