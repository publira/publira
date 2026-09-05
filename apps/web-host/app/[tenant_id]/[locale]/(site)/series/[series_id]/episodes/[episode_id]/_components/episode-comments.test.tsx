// @vitest-environment jsdom

import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EpisodeCommentItem, EpisodeCommentPage } from "#lib/comments";

import { EpisodeComments } from "./episode-comments";

const {
  mockGetMe,
  mockGetTenantCommentMode,
  mockListEpisodeComments,
  mockListMyEpisodeComments,
} = vi.hoisted(() => ({
  mockGetMe: vi.fn(),
  mockGetTenantCommentMode: vi.fn(),
  mockListEpisodeComments: vi.fn(),
  mockListMyEpisodeComments: vi.fn(),
}));

vi.mock("#components/locale-provider", () => ({
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
  getTenantCommentMode: mockGetTenantCommentMode,
  getTenantDisplayTimeZone: () => Promise.resolve("Asia/Tokyo"),
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
// cannot mount.
vi.mock("#components/action-form", () => ({
  ActionForm: ({ children }: { children: React.ReactNode }) => (
    <form>{children}</form>
  ),
}));

vi.mock("./comment-delete-button", () => ({
  CommentDeleteButton: ({ commentPublicId }: { commentPublicId: string }) => (
    <button type="button">Delete {commentPublicId}</button>
  ),
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const viewer = { name: "Sample Member", publicId: "SeedMMBRAAA1", role: "" };

const publicComment = (
  publicId: string,
  createdAt: string,
  overrides: Partial<EpisodeCommentItem> = {}
): EpisodeCommentItem => ({
  authorName: "Another Reader",
  authorPublicId: "OthrMMBRAAA1",
  awaitingApproval: false,
  body: `Body of ${publicId}`,
  createdAt,
  publicId,
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

const renderSection = async (token = "") => {
  const section = await EpisodeComments({
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
  mockGetTenantCommentMode.mockResolvedValue("immediate");
  mockGetMe.mockResolvedValue(null);
  mockListEpisodeComments.mockResolvedValue(listPage([]));
  mockListMyEpisodeComments.mockResolvedValue({ ok: true, value: [] });
});

afterEach(() => {
  cleanup();
});

describe("EpisodeComments", () => {
  it("renders nothing at all where the tenant has commenting turned off", async () => {
    mockGetTenantCommentMode.mockResolvedValueOnce("disabled");

    const section = await EpisodeComments({
      episodePublicId: "SeedEPSDAAA1",
      seriesPublicId: "SeedSERSAAA1",
      tenantId,
      token: "",
    });

    expect(section).toBeNull();
    expect(mockListEpisodeComments).not.toHaveBeenCalled();
  });

  it("offers a signed-out reader a way in instead of a posting form", async () => {
    await renderSection();

    expect(screen.getByText("Sign in to leave a comment.")).toBeDefined();
    const signIn = screen.getByRole("link", { name: "Sign in" });
    expect(signIn.getAttribute("href")).toBe(
      "/login?returnTo=%2Fseries%2FSeedSERSAAA1%2Fepisodes%2FSeedEPSDAAA1"
    );
    expect(screen.queryByLabelText("Your comment")).toBeNull();
  });

  it("gives a signed-in reader the posting form", async () => {
    mockGetMe.mockResolvedValueOnce(viewer);

    await renderSection();

    expect(screen.getByLabelText("Your comment")).toBeDefined();
    expect(screen.queryByText("Sign in to leave a comment.")).toBeNull();
  });

  it("says a comment is waiting where the tenant reviews them first", async () => {
    mockGetTenantCommentMode.mockResolvedValueOnce("approval_required");

    await renderSection();

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
    expect(screen.queryByText("Delete CmntAAAAAAA1")).toBeNull();
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
      "/series/SeedSERSAAA1/episodes/SeedEPSDAAA1?comments=next#comments"
    );
  });
});
