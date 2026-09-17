import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getMyViewerPreferences,
  saveWideViewerPreference,
} from "./viewer-preferences";

const {
  mockGetViewerPreferences,
  mockResolveAccessToken,
  mockUpdateViewerPreferences,
} = vi.hoisted(() => ({
  mockGetViewerPreferences: vi.fn(),
  mockResolveAccessToken: vi.fn(),
  mockUpdateViewerPreferences: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    auth: {
      getViewerPreferences: mockGetViewerPreferences,
      updateViewerPreferences: mockUpdateViewerPreferences,
    },
  },
  buildSessionHeaders: (accessToken: string) => ({
    Authorization: `Bearer ${accessToken}`,
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCESS_TOKEN = "session-token";

describe("getMyViewerPreferences", () => {
  beforeEach(() => {
    mockGetViewerPreferences.mockResolvedValue({
      preferences: { wideViewerEnabled: true },
    });
  });

  it("answers what the member saved", async () => {
    await expect(
      getMyViewerPreferences({ accessToken: ACCESS_TOKEN, tenantId: TENANT_ID })
    ).resolves.toEqual({ wideViewerEnabled: true });
    expect(mockGetViewerPreferences).toHaveBeenCalledWith(
      { tenant: { tenantId: TENANT_ID } },
      { Authorization: "Bearer session-token" }
    );
  });

  it("answers the defaults for a guest without asking the API", async () => {
    await expect(
      getMyViewerPreferences({ accessToken: "", tenantId: TENANT_ID })
    ).resolves.toEqual({ wideViewerEnabled: false });
    expect(mockGetViewerPreferences).not.toHaveBeenCalled();
  });

  it("answers the defaults when the API refuses the read", async () => {
    mockGetViewerPreferences.mockRejectedValue(
      new ConnectError("invalid session", Code.Unauthenticated)
    );

    await expect(
      getMyViewerPreferences({ accessToken: ACCESS_TOKEN, tenantId: TENANT_ID })
    ).resolves.toEqual({ wideViewerEnabled: false });
  });

  it("lets a failure it cannot explain reach the boundary", async () => {
    mockGetViewerPreferences.mockRejectedValue(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      getMyViewerPreferences({ accessToken: ACCESS_TOKEN, tenantId: TENANT_ID })
    ).rejects.toThrow("boom");
  });
});

describe("saveWideViewerPreference", () => {
  beforeEach(() => {
    mockResolveAccessToken.mockResolvedValue(ACCESS_TOKEN);
    mockUpdateViewerPreferences.mockResolvedValue({
      preferences: { wideViewerEnabled: true },
    });
  });

  it("writes the choice for the signed-in member", async () => {
    await saveWideViewerPreference({
      tenantId: TENANT_ID,
      wideViewerEnabled: true,
    });

    expect(mockUpdateViewerPreferences).toHaveBeenCalledWith(
      { tenant: { tenantId: TENANT_ID }, wideViewerEnabled: true },
      { Authorization: "Bearer session-token" }
    );
  });

  it("writes nothing for a reader without a session", async () => {
    mockResolveAccessToken.mockResolvedValue("");

    await saveWideViewerPreference({
      tenantId: TENANT_ID,
      wideViewerEnabled: true,
    });

    expect(mockUpdateViewerPreferences).not.toHaveBeenCalled();
  });

  it("swallows a session that expired while the episode was open", async () => {
    mockUpdateViewerPreferences.mockRejectedValue(
      new ConnectError("invalid session", Code.Unauthenticated)
    );

    await expect(
      saveWideViewerPreference({ tenantId: TENANT_ID, wideViewerEnabled: true })
    ).resolves.toBeUndefined();
  });

  it("lets a failure it cannot explain reach the caller", async () => {
    mockUpdateViewerPreferences.mockRejectedValue(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      saveWideViewerPreference({ tenantId: TENANT_ID, wideViewerEnabled: true })
    ).rejects.toThrow("boom");
  });
});
