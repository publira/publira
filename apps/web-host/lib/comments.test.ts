import { Code, ConnectError } from "@publira/api-client/errors";
import { CommentReportReason } from "@publira/api-client/public/comment";
import { ClientSurface } from "@publira/api-client/public/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EpisodeCommentItem, EpisodeCommentPage } from "./comments";
import {
  episodeCommentDisplayName,
  listEpisodeComments,
  listMyEpisodeComments,
  mergeOwnEpisodeComments,
  postEpisodeComment,
  reportEpisodeComment,
  withdrawEpisodeComment,
} from "./comments";

const {
  mockListEpisodeComments,
  mockListMyEpisodeComments,
  mockPostEpisodeComment,
  mockReportEpisodeComment,
  mockResolveAccessToken,
  mockWithdrawEpisodeComment,
} = vi.hoisted(() => ({
  mockListEpisodeComments: vi.fn(),
  mockListMyEpisodeComments: vi.fn(),
  mockPostEpisodeComment: vi.fn(),
  mockReportEpisodeComment: vi.fn(),
  mockResolveAccessToken: vi.fn(),
  mockWithdrawEpisodeComment: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    comment: {
      listEpisodeComments: mockListEpisodeComments,
      listMyEpisodeComments: mockListMyEpisodeComments,
      postEpisodeComment: mockPostEpisodeComment,
      reportEpisodeComment: mockReportEpisodeComment,
      withdrawEpisodeComment: mockWithdrawEpisodeComment,
    },
  },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const episodeId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const episodePublicId = "SeedEPSDAAA1";
const commentId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const author = { name: "Sample Member", publicId: "SeedMMBRAAA1" };

const comment = (
  overrides: Partial<EpisodeCommentItem> & { createdAt: string }
): EpisodeCommentItem => ({
  authorName: "Sample Member",
  authorPublicId: "SeedMMBRAAA1",
  awaitingApproval: false,
  body: "A comment",
  creatorName: "",
  id: `C${overrides.createdAt}`,
  ...overrides,
});

const page = (
  comments: EpisodeCommentItem[],
  tokens: Partial<Pick<EpisodeCommentPage, "nextToken" | "previousToken">> = {}
): EpisodeCommentPage => ({
  comments,
  nextToken: tokens.nextToken ?? "",
  previousToken: tokens.previousToken ?? "",
});

describe("listEpisodeComments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps the published rows and both page tokens", async () => {
    mockListEpisodeComments.mockResolvedValueOnce({
      comments: [
        {
          authorName: "Sample Member",
          authorPublicId: "SeedMMBRAAA1",
          body: "Loved this episode",
          createdAt: "2026-09-01T10:00:00Z",
          id: "CmntAAAAAAA1",
        },
      ],
      nextToken: "next",
      previousToken: "previous",
    });

    const result = await listEpisodeComments(tenantId, {
      episodeId,
      episodePublicId,
      locale: "en",
    });

    expect(mockListEpisodeComments.mock.calls[0]?.[0]).toMatchObject({
      episodeId,
      surface: ClientSurface.WEB,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        comments: [
          {
            authorName: "Sample Member",
            authorPublicId: "SeedMMBRAAA1",
            awaitingApproval: false,
            body: "Loved this episode",
            createdAt: "2026-09-01T10:00:00Z",
            creatorName: "",
            id: "CmntAAAAAAA1",
          },
        ],
        nextToken: "next",
        previousToken: "previous",
      },
    });
  });

  it("carries the name the episode credits a creator's comment under", async () => {
    mockListEpisodeComments.mockResolvedValueOnce({
      comments: [
        {
          authorName: "Sample Member",
          authorPublicId: "SeedMMBRAAA1",
          body: "Thank you for reading",
          createdAt: "2026-09-02T10:00:00Z",
          creator: {
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            name: "Sample Author",
            publicId: "SeedCRTRAAA1",
          },
          id: "CmntAAAAAAA2",
        },
        {
          authorName: "Another Reader",
          authorPublicId: "OthrMMBRAAA1",
          body: "Loved this episode",
          createdAt: "2026-09-01T10:00:00Z",
          id: "CmntAAAAAAA1",
        },
      ],
    });

    const result = await listEpisodeComments(tenantId, {
      episodeId,
      episodePublicId,
      locale: "en",
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        comments: [
          { authorName: "Sample Member", creatorName: "Sample Author" },
          { authorName: "Another Reader", creatorName: "" },
        ],
      },
    });
  });

  it("reads a missing episode as an empty page, not as a failure", async () => {
    mockListEpisodeComments.mockRejectedValueOnce(
      new ConnectError("gone", Code.NotFound)
    );

    const result = await listEpisodeComments(tenantId, {
      episodeId,
      episodePublicId,
      locale: "en",
    });

    expect(result).toEqual({
      ok: true,
      value: { comments: [], nextToken: "", previousToken: "" },
    });
  });

  it("reports an unreachable API as a value, because a cache fill must not throw", async () => {
    mockListEpisodeComments.mockRejectedValueOnce(
      new ConnectError("down", Code.Unavailable)
    );

    const result = await listEpisodeComments(tenantId, {
      episodeId,
      episodePublicId,
      locale: "en",
    });

    expect(result.ok).toBe(false);
  });
});

describe("listMyEpisodeComments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("session-token");
  });

  it("gives the caller's own rows the author name the message leaves out", async () => {
    mockListMyEpisodeComments.mockResolvedValueOnce({
      comments: [
        {
          awaitingApproval: true,
          body: "Waiting for approval",
          createdAt: "2026-09-02T10:00:00Z",
          id: "CmntAAAAAAA2",
        },
      ],
    });

    const result = await listMyEpisodeComments(tenantId, {
      author,
      episodeId,
      episodePublicId,
      locale: "en",
    });

    expect(mockListMyEpisodeComments.mock.calls[0]?.[0]).toMatchObject({
      episodeId,
      surface: ClientSurface.WEB,
    });
    expect(result).toEqual({
      ok: true,
      value: [
        {
          authorName: "Sample Member",
          authorPublicId: "SeedMMBRAAA1",
          awaitingApproval: true,
          body: "Waiting for approval",
          createdAt: "2026-09-02T10:00:00Z",
          creatorName: "",
          id: "CmntAAAAAAA2",
        },
      ],
    });
  });

  it("keeps the credit the episode gives the caller on their own rows", async () => {
    mockListMyEpisodeComments.mockResolvedValueOnce({
      comments: [
        {
          awaitingApproval: true,
          body: "Thank you for reading",
          createdAt: "2026-09-02T10:00:00Z",
          creator: {
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            name: "Sample Author",
            publicId: "SeedCRTRAAA1",
          },
          id: "CmntAAAAAAA2",
        },
      ],
    });

    const result = await listMyEpisodeComments(tenantId, {
      author,
      episodeId,
      episodePublicId,
      locale: "en",
    });

    expect(result).toMatchObject({
      ok: true,
      value: [{ authorName: "Sample Member", creatorName: "Sample Author" }],
    });
  });

  it("does not call the RPC without a session", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("");

    const result = await listMyEpisodeComments(tenantId, {
      author,
      episodeId,
      episodePublicId,
      locale: "en",
    });

    expect(result).toEqual({ ok: true, value: [] });
    expect(mockListMyEpisodeComments).not.toHaveBeenCalled();
  });
});

describe("episodeCommentDisplayName", () => {
  it("shows a creator's comment under the name the episode credits", () => {
    expect(
      episodeCommentDisplayName({
        authorName: "Sample Member",
        creatorName: "Sample Author",
      })
    ).toBe("Sample Author");
  });

  it("shows a reader's comment under their account name", () => {
    expect(
      episodeCommentDisplayName({
        authorName: "Sample Member",
        creatorName: "",
      })
    ).toBe("Sample Member");
  });
});

describe("mergeOwnEpisodeComments", () => {
  it("places the caller's own comments among the public ones by date", () => {
    const merged = mergeOwnEpisodeComments(
      page([
        comment({ createdAt: "2026-09-03T00:00:00Z", id: "P3" }),
        comment({ createdAt: "2026-09-01T00:00:00Z", id: "P1" }),
      ]),
      [
        comment({
          awaitingApproval: true,
          createdAt: "2026-09-02T00:00:00Z",
          id: "O2",
        }),
      ]
    );

    expect(merged.map((item) => item.id)).toEqual(["P3", "O2", "P1"]);
  });

  it("keeps an own comment newer than the page off every page but the first", () => {
    const merged = mergeOwnEpisodeComments(
      page(
        [
          comment({ createdAt: "2026-09-03T00:00:00Z", id: "P3" }),
          comment({ createdAt: "2026-09-01T00:00:00Z", id: "P1" }),
        ],
        { previousToken: "previous" }
      ),
      [comment({ createdAt: "2026-09-09T00:00:00Z", id: "O9" })]
    );

    expect(merged.map((item) => item.id)).toEqual(["P3", "P1"]);
  });

  it("keeps an own comment older than the page off a page that has a next one", () => {
    const merged = mergeOwnEpisodeComments(
      page(
        [
          comment({ createdAt: "2026-09-03T00:00:00Z", id: "P3" }),
          comment({ createdAt: "2026-09-02T00:00:00Z", id: "P2" }),
        ],
        { nextToken: "next" }
      ),
      [comment({ createdAt: "2026-09-01T00:00:00Z", id: "O1" })]
    );

    expect(merged.map((item) => item.id)).toEqual(["P3", "P2"]);
  });

  it("shows own comments on an empty list only while it is the one page there is", () => {
    const own = [comment({ createdAt: "2026-09-01T00:00:00Z", id: "O1" })];

    expect(mergeOwnEpisodeComments(page([]), own)).toHaveLength(1);
    expect(
      mergeOwnEpisodeComments(page([], { previousToken: "previous" }), own)
    ).toHaveLength(0);
  });

  // The API keeps the two lists apart, but the public one is cached and the
  // caller's own is not, so a comment staff removed a moment ago is briefly in
  // both. The bodies differ only so the assertion can name which row survived.
  it("renders a comment held by both lists once, from the public row", () => {
    const merged = mergeOwnEpisodeComments(
      page([
        comment({
          body: "the cached copy",
          createdAt: "2026-09-02T00:00:00Z",
          id: "P2",
        }),
      ]),
      [
        comment({
          body: "the caller's own copy",
          createdAt: "2026-09-02T00:00:00Z",
          id: "P2",
        }),
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.body).toBe("the cached copy");
  });
});

describe("postEpisodeComment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("session-token");
  });

  it("reports that a comment awaits approval so the reader can be told", async () => {
    mockPostEpisodeComment.mockResolvedValueOnce({
      comment: { awaitingApproval: true },
    });

    await expect(
      postEpisodeComment({
        body: "A comment",
        episodeId,
        locale: "en",
        tenantId,
      })
    ).resolves.toEqual({ awaitingApproval: true, ok: true });
    expect(mockPostEpisodeComment.mock.calls[0]?.[0]).toMatchObject({
      episodeId,
      surface: ClientSurface.WEB,
    });
  });

  it("returns the rejection of a locked episode instead of throwing", async () => {
    mockPostEpisodeComment.mockRejectedValueOnce(
      new ConnectError("locked", Code.PermissionDenied)
    );

    const result = await postEpisodeComment({
      body: "A comment",
      episodeId,
      locale: "en",
      tenantId,
    });

    expect(result.ok).toBe(false);
  });

  it("lets a rejected session through, so the caller can send the reader to sign in", async () => {
    mockPostEpisodeComment.mockRejectedValueOnce(
      new ConnectError("expired", Code.Unauthenticated)
    );

    await expect(
      postEpisodeComment({
        body: "A comment",
        episodeId,
        locale: "en",
        tenantId,
      })
    ).rejects.toThrow("expired");
  });
});

describe("withdrawEpisodeComment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("session-token");
  });

  it("takes the comment down", async () => {
    mockWithdrawEpisodeComment.mockResolvedValueOnce({});

    await expect(
      withdrawEpisodeComment({
        commentId,
        locale: "en",
        tenantId,
      })
    ).resolves.toEqual({ ok: true });
  });

  it("reports a comment that is not the caller's own", async () => {
    mockWithdrawEpisodeComment.mockRejectedValueOnce(
      new ConnectError("not found", Code.NotFound)
    );

    const result = await withdrawEpisodeComment({
      commentId,
      locale: "en",
      tenantId,
    });

    expect(result.ok).toBe(false);
  });
});

describe("reportEpisodeComment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("session-token");
  });

  it("sends the stored reason as the wire enum", async () => {
    mockReportEpisodeComment.mockResolvedValueOnce({});

    await expect(
      reportEpisodeComment({
        commentId,
        locale: "en",
        note: "  Nothing to do with the episode.  ",
        reason: "spoiler",
        tenantId,
      })
    ).resolves.toEqual({ ok: true });
    expect(mockReportEpisodeComment).toHaveBeenCalledWith(
      {
        commentId,
        note: "  Nothing to do with the episode.  ",
        reason: CommentReportReason.SPOILER,
        surface: ClientSurface.WEB,
        tenant: { tenantId },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("returns the rejection of a comment the reader may not report", async () => {
    mockReportEpisodeComment.mockRejectedValueOnce(
      new ConnectError(
        "cannot report your own comment",
        Code.FailedPrecondition
      )
    );

    const result = await reportEpisodeComment({
      commentId,
      locale: "en",
      note: "",
      reason: "spam",
      tenantId,
    });

    expect(result.ok).toBe(false);
  });

  it("lets a rejected session through, so the caller can send the reader to sign in", async () => {
    mockReportEpisodeComment.mockRejectedValueOnce(
      new ConnectError("expired", Code.Unauthenticated)
    );

    await expect(
      reportEpisodeComment({
        commentId,
        locale: "en",
        note: "",
        reason: "spam",
        tenantId,
      })
    ).rejects.toThrow("expired");
  });
});
