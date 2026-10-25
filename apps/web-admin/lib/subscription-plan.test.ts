import {
  SubscriptionInterval,
  SubscriptionPlanScope,
} from "@publira/api-client/admin/types";
import {
  BadRequestSchema,
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockCreateSubscriptionPlan,
  mockDeleteSubscriptionPlan,
  mockGetAccessToken,
  mockListSubscriptionPlans,
  mockUpdateSubscriptionPlan,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockCreateSubscriptionPlan: vi.fn(),
  mockDeleteSubscriptionPlan: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockListSubscriptionPlans: vi.fn(),
  mockUpdateSubscriptionPlan: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    subscriptionPlans: {
      createSubscriptionPlan: mockCreateSubscriptionPlan,
      deleteSubscriptionPlan: mockDeleteSubscriptionPlan,
      listSubscriptionPlans: mockListSubscriptionPlans,
      updateSubscriptionPlan: mockUpdateSubscriptionPlan,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const SESSION_HEADERS = {
  headers: { Authorization: "Bearer session-token" },
};

const LABEL_ID = "018f0e6a-7000-7000-8000-000000000101";
const SERIES_ID = "018f0e6a-7000-7000-8000-000000000201";

/** The same failure, with the field the API names as the one it refused. */
const invalidField = (field: string, code = Code.InvalidArgument) =>
  new ConnectError("invalid", code, undefined, [
    { desc: BadRequestSchema, value: { fieldViolations: [{ field }] } },
  ]);

const reasonError = (code: Code, reason: string) =>
  new ConnectError("refused", code, undefined, [
    { desc: ErrorInfoSchema, value: { domain: "publira", reason } },
  ]);

const rawPlan = {
  currency: "JPY",
  description: "Every episode of the label, every month.",
  id: "018f0e6a-7000-7000-8000-000000000001",
  interval: SubscriptionInterval.MONTH,
  intervalCount: 1,
  labelIds: [LABEL_ID],
  name: "Monthly pass",
  priceAmount: 980,
  publicId: "PLAN0001",
  published: true,
  scope: SubscriptionPlanScope.LABEL,
  seriesIds: [],
  stripePriceId: "price_monthly",
  subscriberCount: 3,
};

const mappedPlan = {
  ...rawPlan,
  interval: "month",
  scope: "label",
};

const saveInput = {
  description: "Every episode of the label, every month.",
  labelIds: [LABEL_ID],
  name: "Monthly pass",
  published: true,
  scope: "label" as const,
  seriesIds: [SERIES_ID],
  stripePriceId: "price_monthly",
  tenantId: "TENANT001",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockGetAccessToken.mockResolvedValue("session-token");
});

describe("listSubscriptionPlans", () => {
  // The API admits only a tenant admin on this RPC, so the read is the
  // operator's own.
  it("reads the tenant's plans with the operator's session, under the plan tag", async () => {
    mockListSubscriptionPlans.mockResolvedValueOnce({ plans: [rawPlan] });

    const { listSubscriptionPlans } = await import("./subscription-plan");
    const result = await listSubscriptionPlans("TENANT001", "en");

    expect(result).toEqual({ ok: true, plans: [mappedPlan] });
    expect(mockListSubscriptionPlans).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      SESSION_HEADERS
    );
    expect(mockCacheTag).toHaveBeenCalledWith("subscription-plans-TENANT001");
  });

  it("reads each scope and interval the API answers", async () => {
    mockListSubscriptionPlans.mockResolvedValueOnce({
      plans: [
        {
          ...rawPlan,
          interval: SubscriptionInterval.YEAR,
          labelIds: [],
          scope: SubscriptionPlanScope.ALL,
        },
        {
          ...rawPlan,
          interval: SubscriptionInterval.WEEK,
          labelIds: [],
          scope: SubscriptionPlanScope.SERIES,
          seriesIds: [SERIES_ID],
        },
        // An interval this build does not know is shown without one.
        { ...rawPlan, interval: SubscriptionInterval.UNSPECIFIED },
      ],
    });

    const { listSubscriptionPlans } = await import("./subscription-plan");
    const result = await listSubscriptionPlans("TENANT001", "en");

    expect(result.ok).toBe(true);
    expect(
      result.plans.map(({ interval, scope }) => ({ interval, scope }))
    ).toEqual([
      { interval: "year", scope: "all" },
      { interval: "week", scope: "series" },
      { interval: "", scope: "label" },
    ]);
  });

  it("asks the page to sign the operator in again when the API rejects the session", async () => {
    mockListSubscriptionPlans.mockRejectedValue(
      new ConnectError("session expired", Code.Unauthenticated)
    );

    const { listSubscriptionPlans } = await import("./subscription-plan");
    const result = await listSubscriptionPlans("TENANT001", "en");

    expect(result).toMatchObject({
      ok: false,
      plans: [],
      requiresSignIn: true,
    });
  });

  it("reports a failed read as a message and drops the cache entry", async () => {
    mockListSubscriptionPlans.mockRejectedValue(
      new ConnectError("upstream is down", Code.Unavailable)
    );

    const { listSubscriptionPlans } = await import("./subscription-plan");
    const result = await listSubscriptionPlans("TENANT001", "en");

    expect(result).toMatchObject({ ok: false, plans: [] });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("throws a failure no screen copy describes", async () => {
    mockListSubscriptionPlans.mockRejectedValue(
      new ConnectError("boom", Code.Internal)
    );

    const { listSubscriptionPlans } = await import("./subscription-plan");

    await expect(listSubscriptionPlans("TENANT001", "en")).rejects.toThrow();
  });
});

describe("getSubscriptionPlan", () => {
  it("picks the plan out of the list by its public id", async () => {
    mockListSubscriptionPlans.mockResolvedValueOnce({ plans: [rawPlan] });

    const { getSubscriptionPlan } = await import("./subscription-plan");

    await expect(
      getSubscriptionPlan({ publicId: "PLAN0001", tenantId: "TENANT001" }, "en")
    ).resolves.toEqual({ ok: true, plan: mappedPlan });
  });

  it("reports a plan the list does not hold as not found", async () => {
    mockListSubscriptionPlans.mockResolvedValueOnce({ plans: [rawPlan] });

    const { getSubscriptionPlan } = await import("./subscription-plan");

    await expect(
      getSubscriptionPlan({ publicId: "PLAN9999", tenantId: "TENANT001" }, "en")
    ).resolves.toEqual({ notFound: true, ok: false });
  });
});

describe("createSubscriptionPlan", () => {
  it("sends the plan with the operator's session, and only the targets its scope names", async () => {
    mockCreateSubscriptionPlan.mockResolvedValueOnce({ plan: rawPlan });

    const { createSubscriptionPlan } = await import("./subscription-plan");
    const result = await createSubscriptionPlan(saveInput, "en");

    expect(result).toEqual({ ok: true, plan: mappedPlan });
    expect(mockCreateSubscriptionPlan).toHaveBeenCalledWith(
      {
        plan: {
          description: "Every episode of the label, every month.",
          labelIds: [LABEL_ID],
          name: "Monthly pass",
          published: true,
          scope: SubscriptionPlanScope.LABEL,
          seriesIds: [],
          stripePriceId: "price_monthly",
        },
        tenant: { tenantId: "TENANT001" },
      },
      SESSION_HEADERS
    );
  });

  it("sends neither labels nor series for the whole catalog", async () => {
    mockCreateSubscriptionPlan.mockResolvedValueOnce({ plan: rawPlan });

    const { createSubscriptionPlan } = await import("./subscription-plan");
    await createSubscriptionPlan({ ...saveInput, scope: "all" }, "en");

    expect(mockCreateSubscriptionPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({
          labelIds: [],
          scope: SubscriptionPlanScope.ALL,
          seriesIds: [],
        }),
      }),
      SESSION_HEADERS
    );
  });

  it.each([
    [
      "the tenant's plan limit",
      reasonError(Code.FailedPrecondition, "SUBSCRIPTION_PLAN_LIMIT"),
      "This site already holds 20 subscription plans, as many as it may. Delete one nobody has subscribed to, then try again.",
    ],
    [
      "a tenant that takes no payments through Stripe",
      new ConnectError("payments disabled", Code.FailedPrecondition),
      "Subscription plans are sold through Stripe. Choose Stripe under Payments › Payment methods, enable payments, and save, then try again.",
    ],
    [
      "a Price another plan bills",
      invalidField("plan.stripe_price_id", Code.AlreadyExists),
      "Another plan already bills this Price. Create a new Price in Stripe for this plan.",
    ],
    [
      "a Price Stripe does not hold",
      invalidField("plan.stripe_price_id"),
      "Stripe has no active recurring Price of one fixed amount with this ID on the tenant's account. Check the ID, and that the Price bills the same amount every period.",
    ],
    [
      "a name longer than the API keeps",
      invalidField("plan.name"),
      "Keep the name to 100 characters or fewer.",
    ],
    [
      "a label the tenant no longer holds",
      invalidField("plan.label_ids"),
      "One of the labels or series no longer exists. Reload the page and choose again.",
    ],
  ])("words %s by what the operator has to do", async (_, error, message) => {
    mockCreateSubscriptionPlan.mockRejectedValue(error);

    const { createSubscriptionPlan } = await import("./subscription-plan");
    const result = await createSubscriptionPlan(saveInput, "en");

    expect(result).toEqual({ message, ok: false });
  });
});

describe("updateSubscriptionPlan", () => {
  it("replaces the plan the id names", async () => {
    mockUpdateSubscriptionPlan.mockResolvedValueOnce({
      plan: { ...rawPlan, published: false },
    });

    const { updateSubscriptionPlan } = await import("./subscription-plan");
    const result = await updateSubscriptionPlan(
      {
        ...saveInput,
        id: rawPlan.id,
        published: false,
        scope: "series",
      },
      "en"
    );

    expect(result).toEqual({
      ok: true,
      plan: { ...mappedPlan, published: false },
    });
    expect(mockUpdateSubscriptionPlan).toHaveBeenCalledWith(
      {
        plan: {
          description: "Every episode of the label, every month.",
          labelIds: [],
          name: "Monthly pass",
          published: false,
          scope: SubscriptionPlanScope.SERIES,
          seriesIds: [SERIES_ID],
          stripePriceId: "price_monthly",
        },
        subscriptionPlanId: rawPlan.id,
        tenant: { tenantId: "TENANT001" },
      },
      SESSION_HEADERS
    );
  });
});

describe("deleteSubscriptionPlan", () => {
  it("removes the plan with the operator's session", async () => {
    mockDeleteSubscriptionPlan.mockResolvedValueOnce({});

    const { deleteSubscriptionPlan } = await import("./subscription-plan");
    const result = await deleteSubscriptionPlan(
      { id: rawPlan.id, tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({ ok: true });
    expect(mockDeleteSubscriptionPlan).toHaveBeenCalledWith(
      { subscriptionPlanId: rawPlan.id, tenant: { tenantId: "TENANT001" } },
      SESSION_HEADERS
    );
  });

  it("tells the operator to unpublish a plan readers have subscribed to", async () => {
    mockDeleteSubscriptionPlan.mockRejectedValue(
      reasonError(Code.FailedPrecondition, "SUBSCRIPTION_PLAN_IN_USE")
    );

    const { deleteSubscriptionPlan } = await import("./subscription-plan");
    const result = await deleteSubscriptionPlan(
      { id: rawPlan.id, tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({
      message:
        "Readers have subscribed to this plan, so it is kept as the record of what they pay for. Unpublish it instead.",
      ok: false,
    });
  });
});
