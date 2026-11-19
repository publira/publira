// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SubscriptionPlanItem } from "#lib/subscription-plan-shared";

import { SubscriptionPlanList } from "./subscription-plan-list";

const translate = bindMessages(sharedCatalog("en"), "en");

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => translate(message, values),
}));

vi.mock("../_lib/actions", () => ({
  deleteSubscriptionPlanAction: vi.fn(),
}));

const plan = (
  overrides: Partial<SubscriptionPlanItem> = {}
): SubscriptionPlanItem => ({
  appStoreProductId: "",
  currency: "JPY",
  description: "",
  googlePlayProductId: "",
  id: "018f0e6a-7000-7000-8000-000000000001",
  interval: "month",
  intervalCount: 1,
  labelIds: [],
  name: "Monthly pass",
  priceAmount: 980,
  publicId: "PLAN0001",
  published: true,
  scope: "all",
  seriesIds: [],
  stripePriceId: "price_monthly",
  subscriberCount: 3,
  ...overrides,
});

const rowOf = (name: string) => {
  const row = screen.getByRole("cell", { name }).closest("tr");

  if (!row) {
    throw new Error(`no row for ${name}`);
  }

  return within(row);
};

afterEach(() => {
  cleanup();
});

describe("SubscriptionPlanList", () => {
  it("states what each plan costs, what it opens, whether it is listed, and who holds it", () => {
    render(
      <SubscriptionPlanList
        locale="en"
        plans={[
          plan(),
          plan({
            id: "018f0e6a-7000-7000-8000-000000000002",
            interval: "month",
            intervalCount: 3,
            labelIds: [
              "018f0e6a-7000-7000-8000-000000000101",
              "018f0e6a-7000-7000-8000-000000000102",
            ],
            name: "Quarterly labels",
            priceAmount: 2500,
            publicId: "PLAN0002",
            published: false,
            scope: "label",
            subscriberCount: 0,
          }),
          plan({
            id: "018f0e6a-7000-7000-8000-000000000003",
            interval: "year",
            name: "One series a year",
            publicId: "PLAN0003",
            scope: "series",
            seriesIds: ["018f0e6a-7000-7000-8000-000000000201"],
          }),
        ]}
        tenantId="TENANT001"
      />
    );

    const monthly = rowOf("Monthly pass");
    expect(monthly.getByText("¥980 a month")).toBeTruthy();
    expect(monthly.getByText("Whole catalog")).toBeTruthy();
    expect(monthly.getByText("Published")).toBeTruthy();
    expect(monthly.getByRole("cell", { name: "3" })).toBeTruthy();
    expect(
      monthly.getByRole("link", { name: "Edit" }).getAttribute("href")
    ).toBe("/subscription-plans/PLAN0001");

    const quarterly = rowOf("Quarterly labels");
    expect(quarterly.getByText("¥2,500 every 3 months")).toBeTruthy();
    expect(quarterly.getByText("2 labels")).toBeTruthy();
    expect(quarterly.getByText("Unpublished")).toBeTruthy();

    const yearly = rowOf("One series a year");
    expect(yearly.getByText("¥980 a year")).toBeTruthy();
    expect(yearly.getByText("1 series")).toBeTruthy();
  });

  it("names the stores whose app sells each plan", () => {
    render(
      <SubscriptionPlanList
        locale="en"
        plans={[
          plan({
            appStoreProductId: "monthly_pass",
            googlePlayProductId: "monthly_pass",
          }),
          plan({
            googlePlayProductId: "yearly_pass",
            id: "018f0e6a-7000-7000-8000-000000000002",
            name: "Yearly pass",
            publicId: "PLAN0002",
          }),
          plan({
            id: "018f0e6a-7000-7000-8000-000000000003",
            name: "Web pass",
            publicId: "PLAN0003",
          }),
        ]}
        tenantId="TENANT001"
      />
    );

    const monthly = rowOf("Monthly pass");
    expect(monthly.getByText("App Store")).toBeTruthy();
    expect(monthly.getByText("Google Play")).toBeTruthy();

    const yearly = rowOf("Yearly pass");
    expect(yearly.queryByText("App Store")).toBeNull();
    expect(yearly.getByText("Google Play")).toBeTruthy();

    expect(rowOf("Web pass").getByText("None")).toBeTruthy();
  });

  it("says the tenant has no plans yet", () => {
    render(
      <SubscriptionPlanList locale="en" plans={[]} tenantId="TENANT001" />
    );

    expect(screen.getByText("No subscription plans yet.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  // A failed read still hands an empty array, and "no plans yet" beside the
  // error would read as the tenant having none.
  it("shows a failed read as an error, not as an empty list", () => {
    render(
      <SubscriptionPlanList
        listErrorMessage="Could not load the subscription plans."
        locale="en"
        plans={[]}
        tenantId="TENANT001"
      />
    );

    expect(
      screen.getByText("Could not display the subscription plans")
    ).toBeTruthy();
    expect(
      screen.getByText("Could not load the subscription plans.")
    ).toBeTruthy();
    expect(screen.queryByText("No subscription plans yet.")).toBeNull();
  });
});
