import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  confirmPlatformEmailChange,
  platformEmailChangeConfirmationCacheTag,
} from "./email-change";

const {
  mockBuildClientAddressHeaders,
  mockCacheLife,
  mockCacheTag,
  mockConfirmEmailChange,
} = vi.hoisted(() => ({
  mockBuildClientAddressHeaders: vi.fn(),
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockConfirmEmailChange: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./api-client", () => ({
  apiClient: {
    auth: {
      confirmEmailChange: mockConfirmEmailChange,
    },
  },
  buildClientAddressHeaders: mockBuildClientAddressHeaders,
  buildSessionHeaders: vi.fn(),
  resolveAccessToken: vi.fn(),
}));

const DROPPED_ENTRY = { expire: 0, revalidate: 0, stale: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  mockBuildClientAddressHeaders.mockResolvedValue({});
});

describe("confirmPlatformEmailChange", () => {
  it("returns the API's answer, kept out of prefetches", async () => {
    mockConfirmEmailChange.mockResolvedValueOnce({
      changed: false,
      confirmed: true,
      pendingConfirmationFor: "new_email",
    });

    await expect(confirmPlatformEmailChange("token_abc")).resolves.toEqual({
      changed: false,
      confirmed: true,
      pendingConfirmationFor: "new_email",
    });
    expect(mockConfirmEmailChange).toHaveBeenCalledWith(
      { token: "token_abc" },
      {}
    );
    expect(mockCacheLife).toHaveBeenCalledWith({ stale: 0 });
    expect(mockCacheTag).toHaveBeenCalledWith(
      platformEmailChangeConfirmationCacheTag
    );
    expect(mockCacheLife).not.toHaveBeenCalledWith(DROPPED_ENTRY);
  });

  it("answers null and drops the entry when the API refuses the token", async () => {
    mockConfirmEmailChange.mockRejectedValueOnce(
      new ConnectError("expired", Code.InvalidArgument)
    );

    await expect(confirmPlatformEmailChange("token_abc")).resolves.toBeNull();
    expect(mockCacheLife).toHaveBeenCalledWith(DROPPED_ENTRY);
  });

  it("throws an unexpected failure outside the cache scope, with the entry dropped", async () => {
    mockConfirmEmailChange.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(confirmPlatformEmailChange("token_abc")).rejects.toThrow(
      "The email change confirmation failed unexpectedly."
    );
    expect(mockCacheLife).toHaveBeenCalledWith(DROPPED_ENTRY);
  });
});
