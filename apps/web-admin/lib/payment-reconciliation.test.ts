import {
  PaymentReconciliationFailure,
  PaymentReconciliationFindingKind,
  PaymentReconciliationMode,
  PaymentReconciliationStatus,
} from "@publira/api-client/admin/payment-reconciliation";
import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockExportPurchases,
  mockGetAccessToken,
  mockListFindings,
  mockListReconciliations,
  mockStart,
} = vi.hoisted(() => ({
  mockExportPurchases: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockListFindings: vi.fn(),
  mockListReconciliations: vi.fn(),
  mockStart: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    paymentReconciliations: {
      exportPurchases: mockExportPurchases,
      listPaymentReconciliationFindings: mockListFindings,
      listPaymentReconciliations: mockListReconciliations,
      startPaymentReconciliation: mockStart,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const {
  exportPurchases,
  isReconciliationUnfinished,
  listPaymentReconciliationFindings,
  listPaymentReconciliations,
  purchasesCsvPath,
  purchasesHref,
  startPaymentReconciliation,
} = await import("./payment-reconciliation");

const SESSION = { headers: { Authorization: "Bearer session-token" } };
const RUN_ID = "018f10d0-0007-7000-8000-000000000001";

const run = {
  endDate: "2026-10-31",
  failure: PaymentReconciliationFailure.UNSPECIFIED,
  findingCount: 2n,
  finishedAt: "2026-11-01T00:01:00Z",
  id: RUN_ID,
  matchedCount: 40n,
  provider: "stripe",
  purchaseCount: 41n,
  recordCount: 41n,
  startDate: "2026-10-01",
  startedAt: "2026-11-01T00:00:00Z",
  status: PaymentReconciliationStatus.SUCCEEDED,
  store: "",
};

const mappedRun = {
  endDate: "2026-10-31",
  failure: "",
  findingCount: 2,
  finishedAt: "2026-11-01T00:01:00Z",
  id: RUN_ID,
  matchedCount: 40,
  provider: "stripe",
  purchaseCount: 41,
  recordCount: 41,
  startDate: "2026-10-01",
  startedAt: "2026-11-01T00:00:00Z",
  status: "succeeded",
  store: "",
};

const finding = {
  id: "018f10d0-0008-7000-8000-000000000001",
  kind: PaymentReconciliationFindingKind.AMOUNT_MISMATCH,
  occurredAt: "2026-10-12T03:00:00Z",
  providerPaymentId: "pi_123",
  purchaseAmount: 500n,
  purchaseCurrency: "JPY",
  purchaseId: "018f10d0-0006-7000-8000-000000000001",
  purchaseRefundedAmount: 0n,
  recordAmount: 500n,
  recordCurrency: "JPY",
  recordRefundedAmount: 200n,
  test: false,
};

describe("payment reconciliation lib", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  describe("listPaymentReconciliations", () => {
    it("passes the cursor through and maps one page of runs", async () => {
      mockListReconciliations.mockResolvedValue({
        nextToken: "next-token",
        previousToken: "",
        reconciliations: [run],
      });

      const result = await listPaymentReconciliations("TENANT001", "en", {
        token: "current-token",
      });

      expect(mockListReconciliations).toHaveBeenCalledWith(
        {
          limit: 20,
          tenant: { tenantId: "TENANT001" },
          token: "current-token",
        },
        SESSION
      );
      expect(result).toEqual({
        nextToken: "next-token",
        ok: true,
        previousToken: "",
        reconciliations: [mappedRun],
      });
    });

    it.each([
      ["an unfinished run", "", "pending"],
      ["a finished run", "2026-11-01T00:01:00Z", "succeeded"],
    ])(
      "reads a state this build does not know on %s by whether it finished",
      async (_label, finishedAt, status) => {
        mockListReconciliations.mockResolvedValue({
          reconciliations: [{ ...run, finishedAt, status: 99 }],
        });

        const result = await listPaymentReconciliations("TENANT001", "en");

        expect(result.reconciliations[0]?.status).toBe(status);
      }
    );

    it("reads why a run failed", async () => {
      mockListReconciliations.mockResolvedValue({
        reconciliations: [
          {
            ...run,
            failure: PaymentReconciliationFailure.CREDENTIALS,
            status: PaymentReconciliationStatus.FAILED,
          },
        ],
      });

      const result = await listPaymentReconciliations("TENANT001", "en");

      expect(result.reconciliations[0]).toMatchObject({
        failure: "credentials",
        status: "failed",
      });
    });

    it("reports a rejected session as a value so the page can raise the redirect", async () => {
      mockListReconciliations.mockRejectedValue(
        new ConnectError("session expired", Code.Unauthenticated)
      );

      const result = await listPaymentReconciliations("TENANT001", "en");

      expect(result).toMatchObject({ ok: false, requiresSignIn: true });
    });

    it("reports a missing session without calling the API", async () => {
      mockGetAccessToken.mockResolvedValue("");

      const result = await listPaymentReconciliations("TENANT001", "en");

      expect(result).toMatchObject({ ok: false, requiresSignIn: true });
      expect(mockListReconciliations).not.toHaveBeenCalled();
    });

    it("rethrows a failure no copy describes", async () => {
      mockListReconciliations.mockRejectedValue(
        new ConnectError("boom", Code.Internal)
      );

      await expect(
        listPaymentReconciliations("TENANT001", "en")
      ).rejects.toThrow("boom");
    });
  });

  describe("listPaymentReconciliationFindings", () => {
    it("passes the run, the filters, and the cursor through and maps the lines", async () => {
      mockListFindings.mockResolvedValue({
        findings: [finding],
        nextToken: "",
        previousToken: "previous-token",
      });

      const result = await listPaymentReconciliationFindings(
        "TENANT001",
        "en",
        {
          kind: "amount_mismatch",
          mode: "test",
          reconciliationId: RUN_ID,
          token: "current-token",
        }
      );

      expect(mockListFindings).toHaveBeenCalledWith(
        {
          kind: PaymentReconciliationFindingKind.AMOUNT_MISMATCH,
          limit: 20,
          mode: PaymentReconciliationMode.TEST,
          reconciliationId: RUN_ID,
          tenant: { tenantId: "TENANT001" },
          token: "current-token",
        },
        SESSION
      );
      expect(result).toEqual({
        findings: [
          {
            id: "018f10d0-0008-7000-8000-000000000001",
            kind: "amount_mismatch",
            occurredAt: "2026-10-12T03:00:00Z",
            providerPaymentId: "pi_123",
            purchaseAmount: 500,
            purchaseCurrency: "JPY",
            purchaseId: "018f10d0-0006-7000-8000-000000000001",
            purchaseRefundedAmount: 0,
            recordAmount: 500,
            recordCurrency: "JPY",
            recordRefundedAmount: 200,
            test: false,
          },
        ],
        nextToken: "",
        ok: true,
        previousToken: "previous-token",
      });
    });

    it("asks for every kind and both modes when no filter is set", async () => {
      mockListFindings.mockResolvedValue({ findings: [] });

      await listPaymentReconciliationFindings("TENANT001", "en", {
        reconciliationId: RUN_ID,
      });

      expect(mockListFindings).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: PaymentReconciliationFindingKind.UNSPECIFIED,
          mode: PaymentReconciliationMode.UNSPECIFIED,
          token: "",
        }),
        SESSION
      );
    });

    it("lists a kind this build has no words for rather than hiding it", async () => {
      mockListFindings.mockResolvedValue({
        findings: [{ ...finding, kind: 99 }],
      });

      const result = await listPaymentReconciliationFindings(
        "TENANT001",
        "en",
        { reconciliationId: RUN_ID }
      );

      expect(result.findings[0]?.kind).toBe("other");
    });

    it("says a run that is gone was replaced", async () => {
      mockListFindings.mockRejectedValue(
        new ConnectError("not found", Code.NotFound)
      );

      const result = await listPaymentReconciliationFindings(
        "TENANT001",
        "en",
        { reconciliationId: RUN_ID }
      );

      expect(result).toMatchObject({
        message: expect.stringContaining("A later reconciliation"),
        ok: false,
      });
    });
  });

  describe("startPaymentReconciliation", () => {
    it("starts the period and answers the runs it wrote", async () => {
      mockStart.mockResolvedValue({ reconciliations: [run] });

      const result = await startPaymentReconciliation(
        {
          endDate: "2026-10-31",
          startDate: "2026-10-01",
          tenantId: "TENANT001",
        },
        "en"
      );

      expect(mockStart).toHaveBeenCalledWith(
        {
          endDate: "2026-10-31",
          startDate: "2026-10-01",
          tenant: { tenantId: "TENANT001" },
        },
        SESSION
      );
      expect(result).toEqual({ ok: true, reconciliations: [mappedRun] });
    });

    it.each([
      [
        "no source is ready",
        Code.FailedPrecondition,
        "No payment provider or store is ready to reconcile with.",
      ],
      [
        "the period runs past today",
        Code.InvalidArgument,
        "The period ends after today in the tenant's time zone.",
      ],
    ])("words a refusal when %s", async (_label, code, message) => {
      mockStart.mockRejectedValue(new ConnectError("refused", code));

      const result = await startPaymentReconciliation(
        {
          endDate: "2026-10-31",
          startDate: "2026-10-01",
          tenantId: "TENANT001",
        },
        "en"
      );

      expect(result).toEqual({
        message: expect.stringContaining(message),
        ok: false,
      });
    });

    it("rethrows a rejected session for the Action to send to login", async () => {
      mockStart.mockRejectedValue(
        new ConnectError("session expired", Code.Unauthenticated)
      );

      await expect(
        startPaymentReconciliation(
          {
            endDate: "2026-10-31",
            startDate: "2026-10-01",
            tenantId: "TENANT001",
          },
          "en"
        )
      ).rejects.toThrow("session expired");
    });
  });

  describe("exportPurchases", () => {
    it("answers the file the API encoded, byte for byte", async () => {
      const csv = new TextEncoder().encode("row_type\r\n");
      mockExportPurchases.mockResolvedValue({ csv });

      const result = await exportPurchases("TENANT001", {
        endDate: "2026-10-31",
        startDate: "2026-10-01",
      });

      expect(mockExportPurchases).toHaveBeenCalledWith(
        {
          endDate: "2026-10-31",
          startDate: "2026-10-01",
          tenant: { tenantId: "TENANT001" },
        },
        SESSION
      );
      expect(result).toEqual({ csv, ok: true });
    });

    it.each([
      ["a refused period", Code.InvalidArgument, "refused"],
      ["a member below tenant admin", Code.PermissionDenied, "refused"],
      ["a rejected session", Code.Unauthenticated, "signedOut"],
    ])("answers %s as no file", async (_label, code, reason) => {
      mockExportPurchases.mockRejectedValue(new ConnectError("no", code));

      const result = await exportPurchases("TENANT001", {
        endDate: "2026-10-31",
        startDate: "2026-10-01",
      });

      expect(result).toEqual({ ok: false, reason });
    });
  });

  it("spells the period out in the links to Purchases and its download", () => {
    const period = { endDate: "2026-10-31", startDate: "2026-10-01" };

    expect(purchasesHref(period)).toBe(
      "/purchases?from=2026-10-01&to=2026-10-31"
    );
    expect(purchasesCsvPath(period)).toBe(
      "/api/v1/purchases/csv?from=2026-10-01&to=2026-10-31"
    );
  });

  it.each([
    ["pending", true],
    ["running", true],
    ["succeeded", false],
    ["failed", false],
  ] as const)("waits on a %s run: %s", (status, unfinished) => {
    expect(isReconciliationUnfinished({ status })).toBe(unfinished);
  });
});
