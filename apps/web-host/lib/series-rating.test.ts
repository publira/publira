import { Code, ConnectError } from "@publira/api-client/errors";
import { ClientSurface } from "@publira/api-client/public/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMySeriesRating } from "./series-rating";

const { read, token } = vi.hoisted(() => ({ read: vi.fn(), token: vi.fn() }));
vi.mock("./api-client", () => ({
  apiClient: { rating: { getMySeriesRating: read } },
  buildSessionHeaders: (session: string) => ({
    headers: { Authorization: `Bearer ${session}` },
  }),
  resolveAccessToken: token,
}));
beforeEach(() => {
  vi.resetAllMocks();
});
describe("getMySeriesRating", () => {
  it("Skips the RPC for guests", async () => {
    token.mockResolvedValue(null);
    expect(await getMySeriesRating("tenant-1", "series-1")).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
  it("Omits a signed-in reader who has not reacted", async () => {
    token.mockResolvedValue("session-1");
    read.mockResolvedValue({ ratedEpisodeCount: 0, ratingAverage: 0 });
    expect(await getMySeriesRating("tenant-1", "series-1")).toBeNull();
  });
  it("Reads the authenticated reader's average within the tenant", async () => {
    token.mockResolvedValue("session-1");
    read.mockResolvedValue({ ratedEpisodeCount: 2, ratingAverage: 3.5 });
    expect(await getMySeriesRating("tenant-1", "series-1")).toBe(3.5);
    expect(read).toHaveBeenCalledWith(
      {
        seriesPublicId: "series-1",
        surface: ClientSurface.WEB,
        tenant: { tenantId: "tenant-1" },
      },
      { headers: { Authorization: "Bearer session-1" } }
    );
  });
  it("Omits the private figure for an expired session", async () => {
    token.mockResolvedValue("expired");
    read.mockRejectedValue(new ConnectError("expired", Code.Unauthenticated));
    expect(await getMySeriesRating("tenant-1", "series-1")).toBeNull();
  });
  it("Lets failures reach the section error boundary", async () => {
    token.mockResolvedValue("session-1");
    const error = new ConnectError("unavailable", Code.Unavailable);
    read.mockRejectedValue(error);
    await expect(getMySeriesRating("tenant-1", "series-1")).rejects.toBe(error);
  });
});
