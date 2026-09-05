import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EpisodeCommentItem, EpisodeCommentPage } from "./comments";
import {
  listEpisodeComments,
  listMyEpisodeComments,
  mergeOwnEpisodeComments,
  postEpisodeComment,
  withdrawEpisodeComment,
} from "./comments";

const {
  mockListEpisodeComments,
  mockListMyEpisodeComments,
  mockPostEpisodeComment,
  mockResolveAccessToken,
  mockWithdrawEpisodeComment,
} = vi.hoisted(() => ({
  mockListEpisodeComments: vi.fn(),
  mockListMyEpisodeComments: vi.fn(),
  mockPostEpisodeComment: vi.fn(),
  mockResolveAccessToken: vi.fn(),
  mockWithdrawEpisodeComment: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    comment: {
      listEpisodeComments: mockListEpisodeComments,
      listMyEpisodeComments: mockListMyEpisodeComments,
      postEpisodeComment: mockPostEpisodeComment,
      withdrawEpisodeComment: mockWithdrawEpisodeComment,
    },
  },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const episodePublicId = "SeedEPSDAAA1";
const author = { name: "Sample Member", publicId: "SeedMMBRAAA1" };

const comment = (
  overrides: Partial<EpisodeCommentItem> & { createdAt: string }
): EpisodeCommentItem => ({
  authorName: "Sample Member",
  authorPublicId: "SeedMMBRAAA1",
  awaitingApproval: false,
  body: "A comment",
  publicId: `C${overrides.createdAt}`,
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
          publicId: "CmntAAAAAAA1",
        },
      ],
      nextToken: "next",
      previousToken: "previous",
    });

    const result = await listEpisodeComments(tenantId, {
      episodePublicId,
      locale: "en",
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
            publicId: "CmntAAAAAAA1",
          },
        ],
        nextToken: "next",
        previousToken: "previous",
      },
    });
  });

  it("reads a missing episode as an empty page, not as a failure", async () => {
    mockListEpisodeComments.mockRejectedValueOnce(
      new ConnectError("gone", Code.NotFound)
    );

    const result = await listEpisodeComments(tenantId, {
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
          publicId: "CmntAAAAAAA2",
        },
      ],
    });

    const result = await listMyEpisodeComments(tenantId, {
      author,
      episodePublicId,
      locale: "en",
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
          publicId: "CmntAAAAAAA2",
        },
      ],
    });
  });

  it("does not call the RPC without a session", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("");

    const result = await listMyEpisodeComments(tenantId, {
      author,
      episodePublicId,
      locale: "en",
    });

    expect(result).toEqual({ ok: true, value: [] });
    expect(mockListMyEpisodeComments).not.toHaveBeenCalled();
  });
});

describe("mergeOwnEpisodeComments", () => {
  it("places the caller's own comments among the public ones by date", () => {
    const merged = mergeOwnEpisodeComments(
      page([
        comment({ createdAt: "2026-09-03T00:00:00Z", publicId: "P3" }),
        comment({ createdAt: "2026-09-01T00:00:00Z", publicId: "P1" }),
      ]),
      [
        comment({
          awaitingApproval: true,
          createdAt: "2026-09-02T00:00:00Z",
          publicId: "O2",
        }),
      ]
    );

    expect(merged.map((item) => item.publicId)).toEqual(["P3", "O2", "P1"]);
  });

  it("keeps an own comment newer than the page off every page but the first", () => {
    const merged = mergeOwnEpisodeComments(
      page(
        [
          comment({ createdAt: "2026-09-03T00:00:00Z", publicId: "P3" }),
          comment({ createdAt: "2026-09-01T00:00:00Z", publicId: "P1" }),
        ],
        { previousToken: "previous" }
      ),
      [comment({ createdAt: "2026-09-09T00:00:00Z", publicId: "O9" })]
    );

    expect(merged.map((item) => item.publicId)).toEqual(["P3", "P1"]);
  });

  it("keeps an own comment older than the page off a page that has a next one", () => {
    const merged = mergeOwnEpisodeComments(
      page(
        [
          comment({ createdAt: "2026-09-03T00:00:00Z", publicId: "P3" }),
          comment({ createdAt: "2026-09-02T00:00:00Z", publicId: "P2" }),
        ],
        { nextToken: "next" }
      ),
      [comment({ createdAt: "2026-09-01T00:00:00Z", publicId: "O1" })]
    );

    expect(merged.map((item) => item.publicId)).toEqual(["P3", "P2"]);
  });

  it("shows own comments on an empty list only while it is the one page there is", () => {
    const own = [
      comment({ createdAt: "2026-09-01T00:00:00Z", publicId: "O1" }),
    ];

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
          publicId: "P2",
        }),
      ]),
      [
        comment({
          body: "the caller's own copy",
          createdAt: "2026-09-02T00:00:00Z",
          publicId: "P2",
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
        episodePublicId,
        locale: "en",
        tenantId,
      })
    ).resolves.toEqual({ awaitingApproval: true, ok: true });
  });

  it("returns the rejection of a locked episode instead of throwing", async () => {
    mockPostEpisodeComment.mockRejectedValueOnce(
      new ConnectError("locked", Code.PermissionDenied)
    );

    const result = await postEpisodeComment({
      body: "A comment",
      episodePublicId,
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
        episodePublicId,
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
        commentPublicId: "CmntAAAAAAA1",
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
      commentPublicId: "CmntAAAAAAA1",
      locale: "en",
      tenantId,
    });

    expect(result.ok).toBe(false);
  });
});
