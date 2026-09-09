import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheTag,
  mockCreateGenre,
  mockDeleteGenre,
  mockGetAccessToken,
  mockListGenres,
  mockReorderGenres,
  mockUpdateGenre,
} = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockCreateGenre: vi.fn(),
  mockDeleteGenre: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockListGenres: vi.fn(),
  mockReorderGenres: vi.fn(),
  mockUpdateGenre: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    genre: {
      createGenre: mockCreateGenre,
      deleteGenre: mockDeleteGenre,
      listGenres: mockListGenres,
      reorderGenres: mockReorderGenres,
      updateGenre: mockUpdateGenre,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockGetAccessToken.mockResolvedValue("session-token");
});

describe("listGenres", () => {
  it("walks every page and keeps the tenant's order", async () => {
    mockListGenres
      .mockResolvedValueOnce({
        genres: [
          { name: "Fantasy", publicId: "GENRE001", slug: "fantasy" },
          { name: "Mystery", publicId: "GENRE002", slug: "mystery" },
        ],
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        genres: [{ name: "Romance", publicId: "GENRE003", slug: "romance" }],
        nextToken: "",
      });

    const { listGenres } = await import("./genre");
    const result = await listGenres("TENANT001", "en");

    expect(result).toEqual({
      genres: [
        { name: "Fantasy", publicId: "GENRE001", slug: "fantasy" },
        { name: "Mystery", publicId: "GENRE002", slug: "mystery" },
        { name: "Romance", publicId: "GENRE003", slug: "romance" },
      ],
      ok: true,
    });
    expect(mockListGenres).toHaveBeenCalledTimes(2);
    expect(mockListGenres.mock.calls[1]?.[0]).toMatchObject({
      tenant: { tenantId: "TENANT001" },
      token: "page-2",
    });
  });

  it("reports a rejected session so the page can raise the login redirect", async () => {
    mockListGenres.mockRejectedValue(
      new ConnectError("session expired", Code.Unauthenticated)
    );

    const { listGenres } = await import("./genre");
    const result = await listGenres("TENANT001", "en");

    expect(result).toMatchObject({
      genres: [],
      ok: false,
      requiresSignIn: true,
    });
  });

  it("rethrows an unclassifiable failure instead of showing an empty list", async () => {
    mockListGenres.mockRejectedValue(new Error("boom"));

    const { listGenres } = await import("./genre");

    await expect(listGenres("TENANT001", "en")).rejects.toThrow("boom");
  });
});

describe("createGenre", () => {
  it("names the collision rather than the shared conflict wording", async () => {
    mockCreateGenre.mockRejectedValue(
      new ConnectError(
        "a genre with this name already exists",
        Code.AlreadyExists
      )
    );

    const { createGenre } = await import("./genre");
    const result = await createGenre(
      { name: "fantasy", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({
      message: "A genre with this name already exists.",
      ok: false,
    });
  });

  it("returns the created genre", async () => {
    mockCreateGenre.mockResolvedValue({
      genre: { name: "Fantasy", publicId: "GENRE001", slug: "fantasy" },
    });

    const { createGenre } = await import("./genre");
    const result = await createGenre(
      { name: "Fantasy", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({
      genre: { name: "Fantasy", publicId: "GENRE001", slug: "fantasy" },
      ok: true,
    });
    expect(mockCreateGenre).toHaveBeenCalledWith(
      { name: "Fantasy", tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });
});

describe("updateGenre", () => {
  it("words a name the API cannot derive a slug from", async () => {
    mockUpdateGenre.mockRejectedValue(
      new ConnectError(
        "name must hold at least one letter",
        Code.InvalidArgument
      )
    );

    const { updateGenre } = await import("./genre");
    const result = await updateGenre(
      { name: "!!!", publicId: "GENRE001", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({
      message:
        "Enter a genre name of at most 50 characters that holds at least one letter or number.",
      ok: false,
    });
  });
});

describe("reorderGenres", () => {
  it("sends the order it wants beside the order it read", async () => {
    mockReorderGenres.mockResolvedValue({
      genres: [
        { name: "Mystery", publicId: "GENRE002", slug: "mystery" },
        { name: "Fantasy", publicId: "GENRE001", slug: "fantasy" },
      ],
    });

    const { reorderGenres } = await import("./genre");
    const result = await reorderGenres(
      {
        expectedPublicIds: ["GENRE001", "GENRE002"],
        publicIds: ["GENRE002", "GENRE001"],
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toMatchObject({ ok: true });
    expect(mockReorderGenres).toHaveBeenCalledWith(
      {
        expectedGenrePublicIds: ["GENRE001", "GENRE002"],
        genrePublicIds: ["GENRE002", "GENRE001"],
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("tells the operator to reload when the order moved underneath them", async () => {
    mockReorderGenres.mockRejectedValue(
      new ConnectError("genre order has changed", Code.FailedPrecondition)
    );

    const { reorderGenres } = await import("./genre");
    const result = await reorderGenres(
      {
        expectedPublicIds: ["GENRE001"],
        publicIds: ["GENRE001"],
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "The genre order changed somewhere else. Reload the page and try again.",
      ok: false,
    });
  });
});

describe("deleteGenre", () => {
  it("explains that a genre a series carries has to be unassigned first", async () => {
    mockDeleteGenre.mockRejectedValue(
      new ConnectError(
        "genre is assigned to 3 series and cannot be deleted",
        Code.FailedPrecondition
      )
    );

    const { deleteGenre } = await import("./genre");
    const result = await deleteGenre(
      { publicId: "GENRE001", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({
      message:
        "This genre is assigned to one or more series. Remove it from every series before deleting it.",
      ok: false,
    });
  });

  it("resolves once the genre is gone", async () => {
    mockDeleteGenre.mockResolvedValue({});

    const { deleteGenre } = await import("./genre");
    const result = await deleteGenre(
      { publicId: "GENRE001", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({ ok: true });
  });
});
