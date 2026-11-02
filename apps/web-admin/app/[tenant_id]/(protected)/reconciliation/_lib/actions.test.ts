import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockAssertSameOrigin, mockGetAccessToken, mockRefresh, mockStart } =
  vi.hoisted(() => ({
    mockAssertSameOrigin: vi.fn(),
    mockGetAccessToken: vi.fn(),
    mockRefresh: vi.fn(),
    mockStart: vi.fn(),
  }));

vi.mock("#lib/action-messages", () => ({
  getActionLocale: () => Promise.resolve("en"),
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("#lib/payment-reconciliation", () => ({
  startPaymentReconciliation: mockStart,
}));

vi.mock("next/cache", () => ({ refresh: mockRefresh }));

const formData = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  data.set("tenant_id", "TENANT001");

  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }

  return data;
};

// Evaluating the Actions' module graph for the first time takes far longer than
// any test's own work, so it is paid here rather than inside one test's timeout.
beforeAll(async () => {
  await import("./actions");
});

describe("startPaymentReconciliationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("starts the period and re-renders the list to show the runs waiting", async () => {
    mockStart.mockResolvedValueOnce({
      ok: true,
      reconciliations: [{ id: "run-1" }, { id: "run-2" }],
    });
    const { startPaymentReconciliationAction } = await import("./actions");

    const result = await startPaymentReconciliationAction(
      null,
      formData({ end_date: "2026-10-31", start_date: "2026-10-01" })
    );

    expect(mockAssertSameOrigin).toHaveBeenCalled();
    expect(mockStart).toHaveBeenCalledWith(
      { endDate: "2026-10-31", startDate: "2026-10-01", tenantId: "TENANT001" },
      "en"
    );
    expect(mockRefresh).toHaveBeenCalled();
    expect(result).toEqual({
      message:
        "A reconciliation was started against 2 sources. The list below shows each once it finishes.",
      ok: true,
    });
  });

  it.each([
    [
      "a missing start",
      { end_date: "2026-10-31", start_date: "" },
      "Choose the first day of the period.",
    ],
    [
      "a day that is not on the calendar",
      { end_date: "2026-02-30", start_date: "2026-02-01" },
      "Choose the last day of the period.",
    ],
    [
      "a reversed period",
      { end_date: "2026-09-30", start_date: "2026-10-01" },
      "The start of the period is after its end. Choose a start on or before the end.",
    ],
    [
      "367 days",
      { end_date: "2026-01-02", start_date: "2025-01-01" },
      "A period covers at most 366 days. Choose a shorter one.",
    ],
  ])("refuses %s without asking the API", async (_label, fields, message) => {
    const { startPaymentReconciliationAction } = await import("./actions");

    const result = await startPaymentReconciliationAction(
      null,
      formData(fields)
    );

    expect(result).toEqual({ message, ok: false });
    expect(mockStart).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("passes the API's refusal through", async () => {
    mockStart.mockResolvedValueOnce({
      message:
        "No payment provider or store is ready to reconcile with. Set one up under Payment methods first.",
      ok: false,
    });
    const { startPaymentReconciliationAction } = await import("./actions");

    const result = await startPaymentReconciliationAction(
      null,
      formData({ end_date: "2026-10-31", start_date: "2026-10-01" })
    );

    expect(result).toEqual({
      message:
        "No payment provider or store is ready to reconcile with. Set one up under Payment methods first.",
      ok: false,
    });
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
