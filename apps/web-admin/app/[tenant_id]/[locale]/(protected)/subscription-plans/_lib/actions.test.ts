import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockCreateSubscriptionPlan,
  mockDeleteSubscriptionPlan,
  mockGetAccessToken,
  mockRedirect,
  mockUpdateSubscriptionPlan,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockCreateSubscriptionPlan: vi.fn(),
  mockDeleteSubscriptionPlan: vi.fn(),
  mockGetAccessToken: vi.fn(),
  // `redirect()` ends the Action by throwing, which the tests stand in for.
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
  mockUpdateSubscriptionPlan: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("#lib/action-messages", () => ({
  getActionLocale: () => Promise.resolve("en"),
}));

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("#lib/subscription-plan", () => ({
  createSubscriptionPlan: mockCreateSubscriptionPlan,
  deleteSubscriptionPlan: mockDeleteSubscriptionPlan,
  subscriptionPlansCacheTag: (tenantId: string) =>
    `subscription-plans-${tenantId}`,
  updateSubscriptionPlan: mockUpdateSubscriptionPlan,
}));

const PLAN_ID = "018f0e6a-7000-7000-8000-000000000001";
const LABEL_ID = "018f0e6a-7000-7000-8000-000000000101";
const SERIES_ID = "018f0e6a-7000-7000-8000-000000000201";

const savedPlan = { id: PLAN_ID, publicId: "PLAN0001" };

/**
 * What the create form posts, with every field filled in. The scope fields
 * post both lists whichever scope is chosen.
 */
const createFormData = (
  fields: Record<string, string | string[] | null> = {}
) => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("name", "  Monthly pass  ");
  formData.set("description", "Every episode of the label.");
  formData.set("stripe_price_id", " price_monthly ");
  formData.set("app_store_product_id", " monthly_pass ");
  formData.set("google_play_product_id", "");
  formData.set("scope", "label");
  formData.append("label_ids", LABEL_ID);
  formData.append("series_ids", SERIES_ID);
  formData.set("published", "on");

  for (const [name, value] of Object.entries(fields)) {
    formData.delete(name);

    for (const entry of value === null ? [] : [value].flat()) {
      formData.append(name, entry);
    }
  }

  return formData;
};

const updateFormData = (
  fields: Record<string, string | string[] | null> = {}
) => createFormData({ subscription_plan_id: PLAN_ID, ...fields });

/** What a row's delete button posts. */
const deleteFormData = () => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("subscription_plan_id", PLAN_ID);

  return formData;
};

// Evaluating the Actions' module graph for the first time takes far longer than
// any test's own work, so it is paid here rather than inside one test's timeout.
beforeAll(async () => {
  await import("./actions");
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  // `withAdminSessionReauth` resolves the session before the mutation runs;
  // without a token every Action under test would redirect to /login.
  mockGetAccessToken.mockResolvedValue("session-token");
});

describe("createSubscriptionPlanAction", () => {
  it("creates the plan and opens it", async () => {
    mockCreateSubscriptionPlan.mockResolvedValueOnce({
      ok: true,
      plan: savedPlan,
    });

    const { createSubscriptionPlanAction } = await import("./actions");

    await expect(
      createSubscriptionPlanAction(null, createFormData())
    ).rejects.toThrow("redirect:/subscription-plans/PLAN0001?created=1");
    expect(mockCreateSubscriptionPlan).toHaveBeenCalledWith(
      {
        appStoreProductId: "monthly_pass",
        description: "Every episode of the label.",
        // Empty sells the plan in no Android app.
        googlePlayProductId: "",
        labelIds: [LABEL_ID],
        // Trimmed, as the API stores them.
        name: "Monthly pass",
        published: true,
        scope: "label",
        seriesIds: [SERIES_ID],
        stripePriceId: "price_monthly",
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("subscription-plans-TENANT001");
  });

  it("saves an unchecked box as unpublished", async () => {
    mockCreateSubscriptionPlan.mockResolvedValueOnce({
      ok: true,
      plan: savedPlan,
    });

    const { createSubscriptionPlanAction } = await import("./actions");

    await expect(
      createSubscriptionPlanAction(null, createFormData({ published: null }))
    ).rejects.toThrow("redirect:");
    expect(mockCreateSubscriptionPlan).toHaveBeenCalledWith(
      expect.objectContaining({ published: false }),
      "en"
    );
  });

  it.each([
    [{ name: "   " }, "Enter the plan's name."],
    [{ name: "a".repeat(101) }, "Keep the name to 100 characters or fewer."],
    [
      { description: "a".repeat(2001) },
      "Keep the description to 2000 characters or fewer.",
    ],
    [{ stripe_price_id: "" }, "Enter the Stripe Price ID."],
    [
      { app_store_product_id: "a".repeat(101) },
      "Keep the App Store product ID to 100 characters or fewer.",
    ],
    [
      { google_play_product_id: "a".repeat(101) },
      "Keep the Google Play product ID to 100 characters or fewer.",
    ],
    [{ scope: "everything" }, "Choose what the plan opens."],
    [{ label_ids: null }, "Choose at least one label."],
    [{ scope: "series", series_ids: null }, "Choose at least one series."],
    [
      {
        label_ids: Array.from(
          { length: 101 },
          (_, index) =>
            `018f0e6a-7000-7000-8000-${String(index).padStart(12, "0")}`
        ),
      },
      "A plan can open up to 100 labels or series.",
    ],
  ])("refuses %o before it is sent", async (fields, message) => {
    const { createSubscriptionPlanAction } = await import("./actions");

    await expect(
      createSubscriptionPlanAction(null, createFormData(fields))
    ).resolves.toEqual({ message, ok: false });
    expect(mockCreateSubscriptionPlan).not.toHaveBeenCalled();
  });

  it("does not ask for the list the scope does not name", async () => {
    mockCreateSubscriptionPlan.mockResolvedValueOnce({
      ok: true,
      plan: savedPlan,
    });

    const { createSubscriptionPlanAction } = await import("./actions");

    await expect(
      createSubscriptionPlanAction(
        null,
        createFormData({ label_ids: null, scope: "all", series_ids: null })
      )
    ).rejects.toThrow("redirect:");
  });

  it("reports what the API refused and stays on the form", async () => {
    mockCreateSubscriptionPlan.mockResolvedValueOnce({
      message: "Another plan already bills this Price.",
      ok: false,
    });

    const { createSubscriptionPlanAction } = await import("./actions");

    await expect(
      createSubscriptionPlanAction(null, createFormData())
    ).resolves.toEqual({
      message: "Another plan already bills this Price.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("hands a refused store product ID back to its field", async () => {
    const refused = {
      fieldErrors: {
        appStoreProductId:
          "Another plan is already sold as this App Store product.",
      },
      message: "Please check the information you entered.",
      ok: false,
    };

    mockCreateSubscriptionPlan.mockResolvedValueOnce(refused);

    const { createSubscriptionPlanAction } = await import("./actions");

    await expect(
      createSubscriptionPlanAction(null, createFormData())
    ).resolves.toEqual(refused);
  });
});

describe("updateSubscriptionPlanAction", () => {
  it("saves every field of the plan the form names", async () => {
    mockUpdateSubscriptionPlan.mockResolvedValueOnce({
      ok: true,
      plan: savedPlan,
    });

    const { updateSubscriptionPlanAction } = await import("./actions");

    await expect(
      updateSubscriptionPlanAction(null, updateFormData({ published: null }))
    ).resolves.toEqual({ message: "Subscription plan updated.", ok: true });
    expect(mockUpdateSubscriptionPlan).toHaveBeenCalledWith(
      {
        appStoreProductId: "monthly_pass",
        description: "Every episode of the label.",
        googlePlayProductId: "",
        id: PLAN_ID,
        labelIds: [LABEL_ID],
        name: "Monthly pass",
        published: false,
        scope: "label",
        seriesIds: [SERIES_ID],
        stripePriceId: "price_monthly",
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("subscription-plans-TENANT001");
  });

  it("refuses a form that names no plan", async () => {
    const { updateSubscriptionPlanAction } = await import("./actions");

    await expect(
      updateSubscriptionPlanAction(
        null,
        updateFormData({ subscription_plan_id: "not-an-id" })
      )
    ).resolves.toEqual({
      message: "The subscription plan ID to update is missing.",
      ok: false,
    });
    expect(mockUpdateSubscriptionPlan).not.toHaveBeenCalled();
  });
});

describe("deleteSubscriptionPlanAction", () => {
  it("deletes the plan and drops the list", async () => {
    mockDeleteSubscriptionPlan.mockResolvedValueOnce({ ok: true });

    const { deleteSubscriptionPlanAction } = await import("./actions");

    await expect(
      deleteSubscriptionPlanAction(null, deleteFormData())
    ).resolves.toEqual({ message: "Subscription plan deleted.", ok: true });
    expect(mockDeleteSubscriptionPlan).toHaveBeenCalledWith(
      { id: PLAN_ID, tenantId: "TENANT001" },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("subscription-plans-TENANT001");
  });

  it("reports a plan the API keeps", async () => {
    mockDeleteSubscriptionPlan.mockResolvedValueOnce({
      message: "Unpublish it instead.",
      ok: false,
    });

    const { deleteSubscriptionPlanAction } = await import("./actions");

    await expect(
      deleteSubscriptionPlanAction(null, deleteFormData())
    ).resolves.toEqual({ message: "Unpublish it instead.", ok: false });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
