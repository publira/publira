import { ClientSurface } from "@publira/api-client/public/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listMyPurchases } from "./purchases";

const { mockListMyPurchases, mockResolveAccessToken } = vi.hoisted(() => ({
  mockListMyPurchases: vi.fn(),
  mockResolveAccessToken: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    purchase: { listMyPurchases: mockListMyPurchases },
  },
  buildSessionHeaders: (accessToken: string) => ({
    Authorization: `Bearer ${accessToken}`,
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCESS_TOKEN = "session-token";

describe("listMyPurchases", () => {
  beforeEach(() => {
    mockResolveAccessToken.mockResolvedValue(ACCESS_TOKEN);
    mockListMyPurchases.mockResolvedValue({
      nextToken: "",
      previousToken: "",
      purchases: [],
    });
  });

  it("reads the library the storefront may show", async () => {
    await listMyPurchases(TENANT_ID, { locale: "en" });

    expect(mockListMyPurchases).toHaveBeenCalledWith(
      {
        limit: 20,
        surface: ClientSurface.WEB,
        tenant: { tenantId: TENANT_ID },
        token: "",
      },
      { Authorization: `Bearer ${ACCESS_TOKEN}` }
    );
  });
});
