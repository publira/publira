import {
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
import { ClientSurface } from "@publira/api-client/public/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMyWaitFreeTicketState } from "./wait-free";

const { mockCacheTag, mockGetMyTicketState } = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockGetMyTicketState: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: mockCacheTag,
}));

vi.mock("./api-client", () => ({
  apiClient: { waitFree: { getMyTicketState: mockGetMyTicketState } },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const notOffered = () =>
  new ConnectError("off", Code.FailedPrecondition, undefined, [
    {
      desc: ErrorInfoSchema,
      value: { domain: "publira", reason: "WAIT_FREE_NOT_OFFERED" },
    },
  ]);

describe("getMyWaitFreeTicketState", () => {
  beforeEach(() => {
    mockCacheTag.mockReset();
    mockGetMyTicketState.mockReset();
  });

  it("asks nothing for a guest", async () => {
    await expect(
      getMyWaitFreeTicketState("TENANT_001", "SERIES_ID", "", "en")
    ).resolves.toEqual({ ok: true, value: null });
    expect(mockGetMyTicketState).not.toHaveBeenCalled();
  });

  it("reads a ready ticket with the reader's session", async () => {
    mockGetMyTicketState.mockResolvedValueOnce({
      nextAvailableAt: "",
      openTickets: [],
    });

    await expect(
      getMyWaitFreeTicketState("TENANT_001", "SERIES_ID", "session", "en")
    ).resolves.toEqual({ ok: true, value: { ready: true } });
    expect(mockGetMyTicketState).toHaveBeenCalledWith(
      {
        seriesId: "SERIES_ID",
        surface: ClientSurface.WEB,
        tenant: { tenantId: "TENANT_001" },
      },
      { headers: { Authorization: "Bearer session" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT_001:reader-access"
    );
  });

  it("reads when a recharging ticket is ready", async () => {
    mockGetMyTicketState.mockResolvedValueOnce({
      nextAvailableAt: "2026-10-06T03:00:00Z",
      openTickets: [],
    });

    await expect(
      getMyWaitFreeTicketState("TENANT_001", "SERIES_ID", "session", "en")
    ).resolves.toEqual({
      ok: true,
      value: { nextAvailableAt: "2026-10-06T03:00:00Z", ready: false },
    });
  });

  it.each([
    ["a rule turned off", notOffered()],
    ["a series no longer shown", new ConnectError("gone", Code.NotFound)],
    ["a rejected session", new ConnectError("no", Code.Unauthenticated)],
  ])("offers nothing for %s", async (_, error) => {
    mockGetMyTicketState.mockRejectedValueOnce(error);

    await expect(
      getMyWaitFreeTicketState("TENANT_001", "SERIES_ID", "session", "en")
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("reports a read that failed, worded in the reader's language", async () => {
    mockGetMyTicketState.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      getMyWaitFreeTicketState("TENANT_001", "SERIES_ID", "session", "en")
    ).resolves.toEqual({
      message: "Your free ticket for this series could not be checked.",
      ok: false,
    });
  });
});
