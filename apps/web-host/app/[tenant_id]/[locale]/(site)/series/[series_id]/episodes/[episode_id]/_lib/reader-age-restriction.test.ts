import { beforeEach, describe, expect, it, vi } from "vitest";

import { getReaderAgeRestriction } from "./reader-age-restriction";

const { mockGetEpisodeViewer, mockReaderHasBirthDate, mockResolveAccessToken } =
  vi.hoisted(() => ({
    mockGetEpisodeViewer: vi.fn(),
    mockReaderHasBirthDate: vi.fn(),
    mockResolveAccessToken: vi.fn(),
  }));

vi.mock("#lib/api-client", () => ({
  resolveAccessToken: mockResolveAccessToken,
}));

vi.mock("#lib/catalog", () => ({
  getEpisodeViewer: mockGetEpisodeViewer,
}));

vi.mock("#lib/reader-age", () => ({
  readerHasBirthDate: mockReaderHasBirthDate,
}));

beforeEach(() => {
  mockGetEpisodeViewer.mockReset();
  mockReaderHasBirthDate.mockReset();
  mockResolveAccessToken.mockReset();
});

const request = {
  checkoutSessionId: "",
  episodePublicId: "EPISODE01",
  locale: "en",
  seriesPublicId: "SERIES01",
  tenantId: "TENANT01",
} as const;

describe("getReaderAgeRestriction", () => {
  it("stops a guest without asking the API about them", async () => {
    mockResolveAccessToken.mockResolvedValue("");

    await expect(getReaderAgeRestriction(request)).resolves.toEqual({
      hasBirthDate: false,
      signedIn: false,
    });
    expect(mockGetEpisodeViewer).not.toHaveBeenCalled();
  });

  it("stops a signed-in reader who has given no birth date", async () => {
    mockResolveAccessToken.mockResolvedValue("session");
    mockGetEpisodeViewer.mockResolvedValue({
      ok: true,
      value: { access: "age_restricted", images: [] },
    });
    mockReaderHasBirthDate.mockResolvedValue(false);

    await expect(getReaderAgeRestriction(request)).resolves.toEqual({
      hasBirthDate: false,
      signedIn: true,
    });
    expect(mockGetEpisodeViewer).toHaveBeenCalledWith(
      "TENANT01",
      "SERIES01",
      "EPISODE01",
      "session",
      "en",
      ""
    );
  });

  it("stops a signed-in reader whose birth date is too recent", async () => {
    mockResolveAccessToken.mockResolvedValue("session");
    mockGetEpisodeViewer.mockResolvedValue({
      ok: true,
      value: { access: "age_restricted", images: [] },
    });
    mockReaderHasBirthDate.mockResolvedValue(true);

    await expect(getReaderAgeRestriction(request)).resolves.toEqual({
      hasBirthDate: true,
      signedIn: true,
    });
  });

  it("lets through a reader the rule opens the episode for", async () => {
    mockResolveAccessToken.mockResolvedValue("session");
    mockGetEpisodeViewer.mockResolvedValue({
      ok: true,
      value: { access: "free", images: [] },
    });

    await expect(getReaderAgeRestriction(request)).resolves.toBeUndefined();
    expect(mockReaderHasBirthDate).not.toHaveBeenCalled();
  });

  it("does not stop a reader when their own read fails", async () => {
    mockResolveAccessToken.mockResolvedValue("session");
    mockGetEpisodeViewer.mockResolvedValue({
      message: "unavailable",
      ok: false,
    });

    await expect(getReaderAgeRestriction(request)).resolves.toBeUndefined();
  });
});
