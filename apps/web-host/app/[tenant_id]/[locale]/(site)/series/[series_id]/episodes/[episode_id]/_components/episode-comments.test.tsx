// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { Locale, MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen, within } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SeriesCommentMode } from "#lib/catalog";
import type { EpisodeCommentItem, EpisodeCommentPage } from "#lib/comments";

import { EpisodeComments } from "./episode-comments";

const {
  messageLocale,
  mockGetMe,
  mockListEpisodeComments,
  mockListMyEpisodeComments,
} = vi.hoisted(() => ({
  messageLocale: { current: "en" as Locale },
  mockGetMe: vi.fn(),
  mockListEpisodeComments: vi.fn(),
  mockListMyEpisodeComments: vi.fn(),
}));

// `<Message>` is an async Server Component, which the client renderer cannot
// mount. It resolves through the real catalog here, so the assertions stay on
// the copy a reader actually sees.
vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog(messageLocale.current))(message, values),
}));

vi.mock("#components/locale-context", () => ({
  useLocale: () => "en",
  useTenantDefaultLocale: () => "en",
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: React.ComponentProps<"a">) => (
    <a href={href}>{children}</a>
  ),
}));

// `getLocale()` reads `next/root-params`, which only the Next.js compiler can
// provide. The catalog is the real one, so the assertions stay on the copy a
// reader actually sees.
vi.mock("#lib/locale", () => ({
  getLocale: () => Promise.resolve("en"),
  loadHostMessages: () => Promise.resolve(sharedCatalog("en")),
}));

vi.mock("#lib/auth", () => ({ getMe: mockGetMe }));

vi.mock("#lib/tenant", () => ({
  getTenantDisplayTimeZone: () => Promise.resolve("UTC"),
}));

// The merge is the real one: where a row lands in the list is exactly what
// these tests are about.
vi.mock("#lib/comments", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    listEpisodeComments: mockListEpisodeComments,
    listMyEpisodeComments: mockListMyEpisodeComments,
  };
});

// A client component with `useActionState`, which the server render below
// cannot mount. What it was handed is exposed so the tests can assert on it.
vi.mock("./episode-comment-dialog", () => ({
  EpisodeCommentDialog: ({
    children,
    initialOpen,
    prompt,
    returnTo,
  }: {
    children: React.ReactNode;
    initialOpen?: boolean;
    prompt?: React.ReactNode;
    returnTo: string;
  }) => (
    <section>
      <button
        data-initial-open={initialOpen}
        data-return-to={returnTo}
        type="button"
      >
        Comments
      </button>
      {prompt ?? <textarea aria-label="Your comment" />}
      {children}
    </section>
  ),
}));

vi.mock("./comment-delete-button", () => ({
  CommentDeleteButton: ({
    "aria-label": ariaLabel,
    commentId,
  }: {
    "aria-label": string;
    commentId: string;
  }) => (
    <button aria-label={ariaLabel} type="button">
      Delete {commentId}
    </button>
  ),
}));

vi.mock("./comment-report-button", () => ({
  CommentReportButton: ({
    "aria-label": ariaLabel,
    commentId,
  }: {
    "aria-label": string;
    commentId: string;
  }) => (
    <button aria-label={ariaLabel} type="button">
      Report {commentId}
    </button>
  ),
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const viewer = { name: "Sample Member", publicId: "SeedMMBRAAA1", role: "" };

const publicComment = (
  id: string,
  createdAt: string,
  overrides: Partial<EpisodeCommentItem> = {}
): EpisodeCommentItem => ({
  authorName: "Another Reader",
  authorPublicId: "OthrMMBRAAA1",
  awaitingApproval: false,
  body: `Body of ${id}`,
  createdAt,
  creatorName: "",
  id,
  ...overrides,
});

const listPage = (
  comments: EpisodeCommentItem[],
  tokens: Partial<Pick<EpisodeCommentPage, "nextToken" | "previousToken">> = {}
) => ({
  ok: true as const,
  value: {
    comments,
    nextToken: tokens.nextToken ?? "",
    previousToken: tokens.previousToken ?? "",
  },
});

const renderSection = async (
  token = "",
  commentMode: SeriesCommentMode = "immediate"
) => {
  const section = await EpisodeComments({
    commentMode,
    episodeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    episodePublicId: "SeedEPSDAAA1",
    seriesPublicId: "SeedSERSAAA1",
    tenantId,
    token,
  });
  render(section);
};

/** The bodies in the order the section put them on the page. */
const renderedBodies = (): string[] =>
  screen
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "")
    .map((text) => text.replaceAll(/\s+/gu, " ").trim());

beforeEach(() => {
  vi.clearAllMocks();
  messageLocale.current = "en";
  mockGetMe.mockResolvedValue(null);
  mockListEpisodeComments.mockResolvedValue(listPage([]));
  mockListMyEpisodeComments.mockResolvedValue({ ok: true, value: [] });
});

afterEach(() => {
  cleanup();
});

describe("EpisodeComments", () => {
  it("renders nothing at all where the series has commenting turned off", async () => {
    const section = await EpisodeComments({
      commentMode: "disabled",
      episodeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      episodePublicId: "SeedEPSDAAA1",
      seriesPublicId: "SeedSERSAAA1",
      tenantId,
      token: "",
    });

    expect(section).toBeNull();
    expect(mockListEpisodeComments).not.toHaveBeenCalled();
  });

  it("offers a signed-out reader a way in instead of a box to write in", async () => {
    await renderSection();

    expect(screen.getByText("Sign in to leave a comment.")).toBeDefined();
    const signIn = screen.getByRole("link", { name: "Sign in" });
    expect(signIn.getAttribute("href")).toBe(
      "/login?returnTo=%2Fseries%2FSeedSERSAAA1%2Fepisodes%2FSeedEPSDAAA1"
    );
    expect(screen.queryByLabelText("Your comment")).toBeNull();
  });

  it("gives a signed-in reader the box to write in", async () => {
    mockGetMe.mockResolvedValueOnce(viewer);

    await renderSection();

    expect(screen.getByLabelText("Your comment")).toBeDefined();
    expect(screen.queryByText("Sign in to leave a comment.")).toBeNull();
  });

  it("opens itself where the URL asks for a page of comments", async () => {
    await renderSection("next");

    expect(
      screen.getByRole("button", { name: "Comments" }).dataset.initialOpen
    ).toBe("true");
  });

  it("says a comment is waiting where the tenant reviews them first", async () => {
    await renderSection("", "approval_required");

    expect(
      screen.getByText("A comment appears here once a moderator approves it.")
    ).toBeDefined();
  });

  it("marks the reader's own comment that nobody else can read yet", async () => {
    mockGetMe.mockResolvedValueOnce(viewer);
    mockListMyEpisodeComments.mockResolvedValueOnce({
      ok: true,
      value: [
        publicComment("CmntAAAAAAA9", "2026-09-02T00:00:00Z", {
          authorName: viewer.name,
          authorPublicId: viewer.publicId,
          awaitingApproval: true,
        }),
      ],
    });

    await renderSection();

    expect(screen.getByText("Awaiting approval")).toBeDefined();
  });

  it("marks a creator's comment and shows it under the credited name", async () => {
    mockListEpisodeComments.mockResolvedValueOnce(
      listPage([
        publicComment("CmntAAAAAAA2", "2026-09-02T00:00:00Z", {
          authorName: "Sample Member",
          creatorName: "Sample Author",
        }),
        publicComment("CmntAAAAAAA1", "2026-09-01T00:00:00Z"),
      ])
    );

    await renderSection();

    const [creatorRow, readerRow] = screen.getAllByRole("listitem");
    if (!(creatorRow && readerRow)) {
      throw new Error("expected two comments");
    }
    expect(within(creatorRow).getByText("Sample Author")).toBeDefined();
    expect(within(creatorRow).getByText("Author")).toBeDefined();
    expect(within(creatorRow).queryByText("Sample Member")).toBeNull();
    expect(within(readerRow).getByText("Another Reader")).toBeDefined();
    expect(within(readerRow).queryByText("Author")).toBeNull();
  });

  it("marks the reader's own comment when the episode credits them", async () => {
    mockGetMe.mockResolvedValueOnce(viewer);
    mockListMyEpisodeComments.mockResolvedValueOnce({
      ok: true,
      value: [
        publicComment("CmntAAAAAAA9", "2026-09-02T00:00:00Z", {
          authorName: viewer.name,
          authorPublicId: viewer.publicId,
          awaitingApproval: true,
          creatorName: "Sample Author",
        }),
      ],
    });

    await renderSection();

    expect(screen.getByText("Author")).toBeDefined();
    expect(screen.getByText("Sample Author")).toBeDefined();
    expect(screen.getByText("Delete CmntAAAAAAA9")).toBeDefined();
  });

  it("names a creator's comment by the credited name in the report control", async () => {
    mockGetMe.mockResolvedValueOnce(viewer);
    mockListEpisodeComments.mockResolvedValueOnce(
      listPage([
        publicComment("CmntAAAAAAA1", "2026-09-01T00:00:00Z", {
          creatorName: "Sample Author",
        }),
      ])
    );

    await renderSection();

    expect(
      screen.getByRole("button", {
        name: "Report the comment Sample Author posted on Sep 1, 2026, 12:00 AM",
      })
    ).toBeDefined();
  });

  // The word is the one each locale gives the person a work is credited to,
  // which is not the one it gives the writer of a comment.
  it.each([
    ["ja", "著者"],
    ["ko", "작가"],
    ["zh-Hans", "作者"],
    ["zh-Hant", "作者"],
  ] as const)("words the badge in %s", async (locale, word) => {
    messageLocale.current = locale;
    mockListEpisodeComments.mockResolvedValueOnce(
      listPage([
        publicComment("CmntAAAAAAA1", "2026-09-01T00:00:00Z", {
          creatorName: "Sample Author",
        }),
      ])
    );

    await renderSection();

    expect(screen.getByText(word)).toBeDefined();
  });

  it("renders a comment removed after it was published exactly as a published one", async () => {
    mockGetMe.mockResolvedValueOnce(viewer);
    mockListEpisodeComments.mockResolvedValueOnce(
      listPage([
        publicComment("CmntAAAAAAA3", "2026-09-03T00:00:00Z"),
        publicComment("CmntAAAAAAA1", "2026-09-01T00:00:00Z"),
      ])
    );
    // `awaiting_approval` is false for a comment staff removed after it was
    // public, so nothing in this row may say that it was removed.
    mockListMyEpisodeComments.mockResolvedValueOnce({
      ok: true,
      value: [
        publicComment("CmntAAAAAAA2", "2026-09-02T00:00:00Z", {
          authorName: viewer.name,
          authorPublicId: viewer.publicId,
        }),
      ],
    });

    await renderSection();

    expect(screen.queryByText("Awaiting approval")).toBeNull();
    const bodies = renderedBodies();
    expect(bodies[1]).toContain("Body of CmntAAAAAAA2");
    expect(bodies.map((body) => body.includes("Body of CmntAAAAAAA2"))).toEqual(
      [false, true, false]
    );
  });

  it("puts the delete control on the reader's own comments only", async () => {
    mockGetMe.mockResolvedValueOnce(viewer);
    mockListEpisodeComments.mockResolvedValueOnce(
      listPage([
        publicComment("CmntAAAAAAA2", "2026-09-02T00:00:00Z", {
          authorName: viewer.name,
          authorPublicId: viewer.publicId,
        }),
        publicComment("CmntAAAAAAA1", "2026-09-01T00:00:00Z"),
      ])
    );

    await renderSection();

    expect(screen.getByText("Delete CmntAAAAAAA2")).toBeDefined();
    expect(
      screen.getByRole("button", {
        name: "Delete your comment posted on Sep 2, 2026, 12:00 AM",
      })
    ).toBeDefined();
    expect(screen.queryByText("Delete CmntAAAAAAA1")).toBeNull();
  });

  it("puts the report control on everyone else's comments only", async () => {
    mockGetMe.mockResolvedValueOnce(viewer);
    mockListEpisodeComments.mockResolvedValueOnce(
      listPage([
        publicComment("CmntAAAAAAA2", "2026-09-02T00:00:00Z", {
          authorName: viewer.name,
          authorPublicId: viewer.publicId,
        }),
        publicComment("CmntAAAAAAA1", "2026-09-01T00:00:00Z"),
      ])
    );

    await renderSection();

    // The reader deletes their own comment instead, which is the one case the
    // API refuses a report for outright.
    expect(screen.getByText("Report CmntAAAAAAA1")).toBeDefined();
    expect(screen.queryByText("Report CmntAAAAAAA2")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Report the comment Another Reader posted on Sep 1, 2026, 12:00 AM",
      })
    ).toBeDefined();
  });

  it("offers no report control to a reader with no session", async () => {
    mockListEpisodeComments.mockResolvedValueOnce(
      listPage([publicComment("CmntAAAAAAA1", "2026-09-01T00:00:00Z")])
    );

    await renderSection();

    expect(screen.queryByText("Report CmntAAAAAAA1")).toBeNull();
  });

  it("reports a failed public read next to the section rather than emptying it", async () => {
    mockListEpisodeComments.mockResolvedValueOnce({
      message: "Could not load the comments. Please try again later.",
      ok: false,
    });

    await renderSection();

    expect(screen.getByText("Could not show the comments")).toBeDefined();
    expect(screen.queryByText("No comments yet.")).toBeNull();
  });

  it("keeps the public comments when only the per-viewer read failed", async () => {
    mockGetMe.mockResolvedValueOnce(viewer);
    mockListEpisodeComments.mockResolvedValueOnce(
      listPage([publicComment("CmntAAAAAAA1", "2026-09-01T00:00:00Z")])
    );
    mockListMyEpisodeComments.mockResolvedValueOnce({
      message: "Could not load your own comments. Please try again later.",
      ok: false,
    });

    await renderSection();

    expect(screen.getByText("Could not show your own comments")).toBeDefined();
    expect(screen.getByText("Body of CmntAAAAAAA1")).toBeDefined();
  });

  it("links the next page of comments back to this episode", async () => {
    mockListEpisodeComments.mockResolvedValueOnce(
      listPage([publicComment("CmntAAAAAAA1", "2026-09-01T00:00:00Z")], {
        nextToken: "next",
      })
    );

    await renderSection();

    const next = screen.getByRole("link", { name: "Next page" });
    expect(next.getAttribute("href")).toBe(
      "/series/SeedSERSAAA1/episodes/SeedEPSDAAA1?comments=next"
    );
  });
});
