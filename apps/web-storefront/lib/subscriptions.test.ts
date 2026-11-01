import { Code, ConnectError } from "@publira/api-client/errors";
import {
  ClientSurface,
  InAppPurchaseStore,
  SubscriptionInterval,
  SubscriptionPlanScope,
  SubscriptionStatus,
} from "@publira/api-client/public/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getMySubscription,
  holdsSubscription,
  listSubscriptionPlans,
  subscriptionPlanOpens,
} from "./subscriptions";
import type { SubscriptionItem, SubscriptionPlanItem } from "./subscriptions";

const {
  mockGetMySubscription,
  mockListSubscriptionPlans,
  mockResolveAccessToken,
} = vi.hoisted(() => ({
  mockGetMySubscription: vi.fn(),
  mockListSubscriptionPlans: vi.fn(),
  mockResolveAccessToken: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    subscription: {
      getMySubscription: mockGetMySubscription,
      listSubscriptionPlans: mockListSubscriptionPlans,
    },
  },
  buildSessionHeaders: (accessToken: string) => ({
    Authorization: `Bearer ${accessToken}`,
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const plan = {
  currency: "USD",
  description: "Every episode of the Night label.",
  id: PLAN_ID,
  interval: SubscriptionInterval.MONTH,
  intervalCount: 1,
  labels: [
    {
      eyeCatchImageVariants: [],
      name: "Night",
      publicId: "LABEL_NIGHT",
      publishedSeriesCount: 3,
    },
  ],
  name: "Night pass",
  priceAmount: 980,
  scope: SubscriptionPlanScope.LABEL,
  series: [],
};

const nightLabel = {
  eyeCatchImageUpdatedAt: undefined,
  eyeCatchImageVariants: undefined,
  name: "Night",
  publicId: "LABEL_NIGHT",
  seriesCount: 3,
};

const planItem = (
  overrides: Partial<SubscriptionPlanItem>
): SubscriptionPlanItem => ({
  currency: "USD",
  description: "",
  id: PLAN_ID,
  interval: "month",
  intervalCount: 1,
  labels: [],
  name: "Night pass",
  priceAmount: 980,
  scope: "all",
  series: [],
  ...overrides,
});

describe("subscriptionPlanOpens", () => {
  const work = { labelPublicId: "LABEL_NIGHT", seriesPublicId: "SERIES_001" };

  it("opens every work for a plan of the whole site", () => {
    expect(
      subscriptionPlanOpens(planItem({ scope: "all" }), {
        labelPublicId: "",
        seriesPublicId: "SERIES_001",
      })
    ).toBe(true);
  });

  it("opens a work filed under a label the plan lists", () => {
    const labelled = planItem({ labels: [nightLabel], scope: "label" });

    expect(subscriptionPlanOpens(labelled, work)).toBe(true);
    expect(
      subscriptionPlanOpens(labelled, { ...work, labelPublicId: "LABEL_DAY" })
    ).toBe(false);
  });

  it("opens no work under no label for a plan of labels", () => {
    expect(
      subscriptionPlanOpens(
        planItem({
          labels: [{ ...nightLabel, publicId: "" }],
          scope: "label",
        }),
        { labelPublicId: "", seriesPublicId: "SERIES_001" }
      )
    ).toBe(false);
  });

  it("opens a work the plan lists by name", () => {
    const named = planItem({
      scope: "series",
      series: [
        {
          credits: [],
          freeEpisodeCount: 0,
          labelName: "",
          publicId: "SERIES_001",
          synopsis: "",
          title: "A long night",
        },
      ],
    });

    expect(subscriptionPlanOpens(named, work)).toBe(true);
    expect(
      subscriptionPlanOpens(named, { ...work, seriesPublicId: "SERIES_002" })
    ).toBe(false);
  });
});

describe("listSubscriptionPlans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("names what each plan costs and the labels it opens, in the reader's locale", async () => {
    mockListSubscriptionPlans.mockResolvedValueOnce({ plans: [plan] });

    await expect(listSubscriptionPlans(TENANT_ID, "en")).resolves.toEqual({
      ok: true,
      value: [
        planItem({
          description: "Every episode of the Night label.",
          labels: [nightLabel],
          scope: "label",
        }),
      ],
    });
    expect(mockListSubscriptionPlans).toHaveBeenCalledWith({
      locale: "en",
      surface: ClientSurface.WEB,
      tenant: { tenantId: TENANT_ID },
    });
  });

  it("drops a plan whose billing unit or scope this build has no name for", async () => {
    mockListSubscriptionPlans.mockResolvedValueOnce({
      plans: [
        { ...plan, interval: SubscriptionInterval.UNSPECIFIED },
        { ...plan, scope: SubscriptionPlanScope.UNSPECIFIED },
      ],
    });

    await expect(listSubscriptionPlans(TENANT_ID, "en")).resolves.toEqual({
      ok: true,
      value: [],
    });
  });

  it("reports a failed read instead of an empty list", async () => {
    mockListSubscriptionPlans.mockRejectedValueOnce(
      new ConnectError("down", Code.Unavailable)
    );

    const result = await listSubscriptionPlans(TENANT_ID, "en");

    expect(result.ok).toBe(false);
  });
});

describe("getMySubscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("session-token");
  });

  it("answers the reader's subscription as Stripe last reported it", async () => {
    mockGetMySubscription.mockResolvedValueOnce({
      subscription: {
        cancelAtPeriodEnd: true,
        currentPeriodEnd: "2026-11-25T00:00:00Z",
        plan: { name: "Night pass" },
        status: SubscriptionStatus.ACTIVE,
      },
    });

    await expect(getMySubscription(TENANT_ID, "en")).resolves.toEqual({
      ok: true,
      subscription: {
        cancelAtPeriodEnd: true,
        currentPeriodEnd: "2026-11-25T00:00:00Z",
        plan: { name: "Night pass" },
        status: "active",
        store: null,
      },
    });
    expect(mockGetMySubscription).toHaveBeenCalledWith(
      { tenant: { tenantId: TENANT_ID } },
      { Authorization: "Bearer session-token" }
    );
  });

  it("answers none for a reader who has never subscribed", async () => {
    mockGetMySubscription.mockResolvedValueOnce({});

    await expect(getMySubscription(TENANT_ID, "en")).resolves.toEqual({
      ok: true,
      subscription: null,
    });
  });

  it("names the store a subscription is billed through", async () => {
    mockGetMySubscription.mockResolvedValueOnce({
      subscription: {
        cancelAtPeriodEnd: false,
        currentPeriodEnd: "2026-12-01T00:00:00Z",
        plan: { name: "Night pass" },
        status: SubscriptionStatus.ACTIVE,
        store: InAppPurchaseStore.APP_STORE,
      },
    });

    await expect(getMySubscription(TENANT_ID, "en")).resolves.toMatchObject({
      ok: true,
      subscription: { store: "app_store" },
    });

    mockGetMySubscription.mockResolvedValueOnce({
      subscription: {
        cancelAtPeriodEnd: false,
        currentPeriodEnd: "2026-12-01T00:00:00Z",
        plan: { name: "Night pass" },
        status: SubscriptionStatus.ACTIVE,
        store: InAppPurchaseStore.GOOGLE_PLAY,
      },
    });

    await expect(getMySubscription(TENANT_ID, "en")).resolves.toMatchObject({
      ok: true,
      subscription: { store: "google_play" },
    });
  });

  it("reads a subscription Stripe bills as billed through no store", async () => {
    mockGetMySubscription.mockResolvedValueOnce({
      subscription: {
        cancelAtPeriodEnd: false,
        currentPeriodEnd: "2026-12-01T00:00:00Z",
        plan: { name: "Night pass" },
        status: SubscriptionStatus.ACTIVE,
        store: InAppPurchaseStore.UNSPECIFIED,
      },
    });

    await expect(getMySubscription(TENANT_ID, "en")).resolves.toMatchObject({
      ok: true,
      subscription: { store: null },
    });
  });

  it("reads a status this build has no name for as no subscription", async () => {
    mockGetMySubscription.mockResolvedValueOnce({
      subscription: {
        cancelAtPeriodEnd: false,
        currentPeriodEnd: "",
        plan: { name: "Night pass" },
        status: SubscriptionStatus.UNSPECIFIED,
      },
    });

    await expect(getMySubscription(TENANT_ID, "en")).resolves.toEqual({
      ok: true,
      subscription: null,
    });
  });

  it("asks a visitor without a session to sign in", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("");

    const result = await getMySubscription(TENANT_ID, "en");

    expect(result).toMatchObject({ ok: false, requiresSignIn: true });
    expect(mockGetMySubscription).not.toHaveBeenCalled();
  });

  it("asks a reader whose session the API rejects to sign in again", async () => {
    mockGetMySubscription.mockRejectedValueOnce(
      new ConnectError("expired", Code.Unauthenticated)
    );

    const result = await getMySubscription(TENANT_ID, "en");

    expect(result).toMatchObject({ ok: false, requiresSignIn: true });
  });

  it("rethrows a failure it cannot classify", async () => {
    mockGetMySubscription.mockRejectedValueOnce(
      new ConnectError("bug", Code.Internal)
    );

    await expect(getMySubscription(TENANT_ID, "en")).rejects.toThrow("bug");
  });
});

const subscriptionIn = (
  status: SubscriptionItem["status"],
  store: SubscriptionItem["store"] = null
): SubscriptionItem => ({
  cancelAtPeriodEnd: false,
  currentPeriodEnd: "",
  plan: { name: "Night pass" },
  status,
  store,
});

describe("holdsSubscription", () => {
  it("holds one that is billing or held back by a payment", () => {
    for (const status of [
      "active",
      "past_due",
      "paused",
      "trialing",
      "unpaid",
    ] as const) {
      expect(holdsSubscription(subscriptionIn(status))).toBe(true);
    }
  });

  it("holds a live store subscription and none that has ended", () => {
    expect(holdsSubscription(subscriptionIn("active", "app_store"))).toBe(true);
    expect(holdsSubscription(subscriptionIn("canceled", "google_play"))).toBe(
      false
    );
  });

  it("holds none that is over or never started", () => {
    for (const status of [
      "canceled",
      "incomplete",
      "incomplete_expired",
    ] as const) {
      expect(holdsSubscription(subscriptionIn(status))).toBe(false);
    }
  });
});
