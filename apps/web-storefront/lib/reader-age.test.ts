import { beforeEach, describe, expect, it, vi } from "vitest";

import { getReaderProvenAgeRating, readerHasBirthDate } from "./reader-age";

const { mockGetMe, mockGetTenantDisplayTimeZone } = vi.hoisted(() => ({
  mockGetMe: vi.fn(),
  mockGetTenantDisplayTimeZone: vi.fn(),
}));

vi.mock("./auth", () => ({
  getMe: mockGetMe,
}));

vi.mock("./tenant", () => ({
  getTenantDisplayTimeZone: mockGetTenantDisplayTimeZone,
}));

describe("getReaderProvenAgeRating", () => {
  beforeEach(() => {
    mockGetMe.mockReset();
    mockGetTenantDisplayTimeZone.mockReset();
    mockGetTenantDisplayTimeZone.mockResolvedValue("UTC");
  });

  it("Reads the rating an adult reader's stored date carries", async () => {
    mockGetMe.mockResolvedValueOnce({
      birthDate: "1990-04-02",
      name: "Alice",
      publicId: "U001",
      role: "reader",
    });

    await expect(getReaderProvenAgeRating("TENANT_001")).resolves.toBe("r18");
  });

  it("Proves nothing for a guest or a reader who has given no date", async () => {
    mockGetMe.mockResolvedValueOnce(null);
    await expect(
      getReaderProvenAgeRating("TENANT_001")
    ).resolves.toBeUndefined();

    mockGetMe.mockResolvedValueOnce({
      birthDate: "",
      name: "Alice",
      publicId: "U001",
      role: "reader",
    });
    await expect(
      getReaderProvenAgeRating("TENANT_001")
    ).resolves.toBeUndefined();
  });

  it("Proves nothing rather than rejecting when the read fails", async () => {
    mockGetMe.mockRejectedValueOnce(new Error("upstream is down"));

    await expect(
      getReaderProvenAgeRating("TENANT_001")
    ).resolves.toBeUndefined();
  });
});

describe("readerHasBirthDate", () => {
  beforeEach(() => {
    mockGetMe.mockReset();
  });

  it("Separates a stored date from none at all", async () => {
    mockGetMe.mockResolvedValueOnce({ birthDate: "2015-01-01" });
    await expect(readerHasBirthDate("TENANT_001")).resolves.toBe(true);

    mockGetMe.mockResolvedValueOnce({ birthDate: " " });
    await expect(readerHasBirthDate("TENANT_001")).resolves.toBe(false);
  });

  it("Answers false rather than rejecting when the read fails", async () => {
    mockGetMe.mockRejectedValueOnce(new Error("upstream is down"));

    await expect(readerHasBirthDate("TENANT_001")).resolves.toBe(false);
  });
});
