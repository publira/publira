import { Code, ConnectError } from "@publira/api-client/errors";
import { ReaderIconPolicy } from "@publira/api-client/public/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCacheLife, mockCacheTag, mockGetTenantReaderIconPolicy } =
  vi.hoisted(() => ({
    mockCacheLife: vi.fn(),
    mockCacheTag: vi.fn(),
    mockGetTenantReaderIconPolicy: vi.fn(),
  }));

// The read runs without the Next.js cache runtime here, so the `"use cache"`
// helpers are stubbed rather than exercised.
vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./api-client", () => ({
  apiClient: {
    tenant: { getTenantReaderIconPolicy: mockGetTenantReaderIconPolicy },
  },
}));

const { getTenantReaderIconChoice, offersReaderIconField } =
  await import("./reader-icon-policy");

const presetVariant = (url: string) => ({
  contentType: "image/png",
  fileSizeBytes: 2048n,
  height: 256,
  label: "original",
  url,
  width: 256,
});

describe("getTenantReaderIconChoice", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockGetTenantReaderIconPolicy.mockReset();
  });

  it("answers an upload for a tenant that lets readers upload", async () => {
    mockGetTenantReaderIconPolicy.mockResolvedValueOnce({
      policy: ReaderIconPolicy.UPLOAD,
      presets: [],
    });

    await expect(getTenantReaderIconChoice("TENANT001")).resolves.toEqual({
      kind: "upload",
    });
    expect(mockGetTenantReaderIconPolicy).toHaveBeenCalledWith({
      tenant: { tenantId: "TENANT001" },
    });
  });

  it("carries the site tag the API drops when the policy or a preset changes", async () => {
    mockGetTenantReaderIconPolicy.mockResolvedValueOnce({
      policy: ReaderIconPolicy.UPLOAD,
      presets: [],
    });

    await getTenantReaderIconChoice("TENANT001");

    expect(mockCacheTag).toHaveBeenCalledWith("tenant:TENANT001:site");
  });

  it("answers the presets, in order, for a tenant that offers presets", async () => {
    mockGetTenantReaderIconPolicy.mockResolvedValueOnce({
      policy: ReaderIconPolicy.PRESET,
      presets: [
        { id: "P1", variants: [presetVariant("/images/presets/p1.png")] },
        { id: "P2", variants: [presetVariant("/images/presets/p2.png")] },
      ],
    });

    await expect(getTenantReaderIconChoice("TENANT001")).resolves.toEqual({
      kind: "preset",
      presets: [
        {
          icon: { height: 256, url: "/images/presets/p1.png", width: 256 },
          id: "P1",
        },
        {
          icon: { height: 256, url: "/images/presets/p2.png", width: 256 },
          id: "P2",
        },
      ],
    });
  });

  it("leaves out a preset with no stored rendition to draw", async () => {
    mockGetTenantReaderIconPolicy.mockResolvedValueOnce({
      policy: ReaderIconPolicy.PRESET,
      presets: [
        { id: "P1", variants: [] },
        { id: "P2", variants: [presetVariant("/images/presets/p2.png")] },
      ],
    });

    await expect(getTenantReaderIconChoice("TENANT001")).resolves.toMatchObject(
      { presets: [{ id: "P2" }] }
    );
  });

  it("answers disabled for a tenant that allows no icon", async () => {
    mockGetTenantReaderIconPolicy.mockResolvedValueOnce({
      policy: ReaderIconPolicy.DISABLED,
      presets: [],
    });

    await expect(getTenantReaderIconChoice("TENANT001")).resolves.toEqual({
      kind: "disabled",
    });
  });

  it("answers disabled for a policy this build does not know", async () => {
    mockGetTenantReaderIconPolicy.mockResolvedValueOnce({
      policy: ReaderIconPolicy.UNSPECIFIED,
      presets: [],
    });

    await expect(getTenantReaderIconChoice("TENANT001")).resolves.toEqual({
      kind: "disabled",
    });
  });

  it("answers disabled when the policy cannot be read", async () => {
    mockGetTenantReaderIconPolicy.mockRejectedValueOnce(
      new ConnectError("down", Code.Unavailable)
    );

    await expect(getTenantReaderIconChoice("TENANT001")).resolves.toEqual({
      kind: "disabled",
    });
    expect(console.warn).toHaveBeenCalledOnce();
  });
});

describe("offersReaderIconField", () => {
  const preset = {
    icon: { height: 256, url: "/images/presets/p1.png", width: 256 },
    id: "P1",
  };

  it.each([
    ["an upload", { kind: "upload" } as const, false, true],
    ["no icon", { kind: "disabled" } as const, true, false],
    ["presets", { kind: "preset", presets: [preset] } as const, false, true],
    [
      "no presets yet, to an account with no icon",
      { kind: "preset", presets: [] } as const,
      false,
      false,
    ],
    [
      "no presets yet, to an account with an icon to remove",
      { kind: "preset", presets: [] } as const,
      true,
      true,
    ],
  ])("for a tenant that offers %s", (_, choice, hasIcon, expected) => {
    expect(offersReaderIconField(choice, hasIcon)).toBe(expected);
  });
});
