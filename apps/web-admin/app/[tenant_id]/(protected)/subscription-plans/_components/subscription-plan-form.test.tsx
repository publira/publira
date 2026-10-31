// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import type * as ActionForm from "@publira/ui-components/action-form";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SubscriptionPlanItem } from "#lib/subscription-plan-shared";

import { SubscriptionPlanForm } from "./subscription-plan-form";

const translate = bindMessages(sharedCatalog("en"), "en");

vi.mock("#components/client-message", () => ({
  ClientMessage: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => translate(message, values),
  useClientMessages: () => translate,
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => translate(message, values),
}));

vi.mock("#lib/get-messages", () => ({
  getMessages: () => Promise.resolve(translate),
}));

const action = (): Promise<ActionForm.State> => Promise.resolve(null);

const LABEL = { id: "018f0e6a-7000-7000-8000-000000000101", name: "Night Owl" };

const SERIES = {
  id: "018f0e6a-7000-7000-8000-000000000201",
  name: "Harbor Lights",
};

const plan: SubscriptionPlanItem = {
  currency: "JPY",
  description: "Every episode of the label, every month.",
  id: "018f0e6a-7000-7000-8000-000000000001",
  interval: "month",
  intervalCount: 1,
  labelIds: [LABEL.id],
  name: "Monthly pass",
  priceAmount: 980,
  publicId: "PLAN0001",
  published: true,
  scope: "label",
  seriesIds: [],
  stripePriceId: "price_monthly",
  subscriberCount: 3,
};

const renderForm = async (
  props: Partial<Parameters<typeof SubscriptionPlanForm>[0]> = {}
) =>
  render(
    await SubscriptionPlanForm({
      action,
      labels: [LABEL],
      series: [SERIES],
      tenantId: "TENANT001",
      ...props,
    })
  );

const postedValues = (name: string): string[] =>
  [
    ...document.querySelectorAll<HTMLInputElement>(
      `input[type="hidden"][name="${name}"]`
    ),
  ].map((input) => input.value);

afterEach(() => {
  cleanup();
});

describe("SubscriptionPlanForm", () => {
  it("asks a new plan for a name and a Stripe Price, and opens the whole catalog until told otherwise", async () => {
    await renderForm();

    expect(screen.getByLabelText<HTMLInputElement>(/^Name/u).required).toBe(
      true
    );
    expect(
      screen.getByLabelText<HTMLInputElement>(/Stripe Price ID/u).required
    ).toBe(true);
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("Description").required
    ).toBe(false);
    expect(
      screen.getByRole("radio", { name: "Whole catalog" }).ariaChecked
    ).toBe("true");
    expect(postedValues("scope")).toEqual(["all"]);
    // Neither picker is offered while the plan opens everything.
    expect(screen.queryByPlaceholderText("Search labels")).toBeNull();
    expect(screen.queryByPlaceholderText("Search series")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Publish" }).ariaChecked).toBe(
      "false"
    );
    expect(screen.getByRole("button", { name: "Create plan" })).toBeTruthy();
  });

  it("opens an existing plan on what it holds", async () => {
    await renderForm({ initialPlan: plan });

    expect(screen.getByLabelText<HTMLInputElement>(/^Name/u).value).toBe(
      "Monthly pass"
    );
    expect(
      screen.getByLabelText<HTMLInputElement>(/Stripe Price ID/u).value
    ).toBe("price_monthly");
    expect(screen.getByRole("radio", { name: "Labels" }).ariaChecked).toBe(
      "true"
    );
    expect(screen.getByText("Night Owl")).toBeTruthy();
    expect(postedValues("label_ids")).toEqual([LABEL.id]);
    expect(postedValues("subscription_plan_id")).toEqual([plan.id]);
    expect(screen.getByRole("checkbox", { name: "Publish" }).ariaChecked).toBe(
      "true"
    );
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  });

  // Switching away and back must not lose what was chosen; the Action sends
  // only the list the scope names.
  it("keeps the labels while the scope is switched to series and back", async () => {
    await renderForm({ initialPlan: plan });

    fireEvent.click(screen.getByRole("radio", { name: "Series" }));

    expect(postedValues("scope")).toEqual(["series"]);
    expect(screen.queryByPlaceholderText("Search labels")).toBeNull();
    expect(screen.getByPlaceholderText("Search series")).toBeTruthy();
    expect(postedValues("label_ids")).toEqual([LABEL.id]);

    fireEvent.click(screen.getByRole("radio", { name: "Labels" }));

    expect(postedValues("scope")).toEqual(["label"]);
    expect(screen.getByText("Night Owl")).toBeTruthy();
  });

  it("says why a list of choices is missing beside its picker", async () => {
    await renderForm({
      initialPlan: plan,
      labels: [],
      labelsErrorMessage: "Could not load the labels.",
    });

    expect(screen.getByText("Could not load the labels.")).toBeTruthy();
    // The plan keeps the labels it names, though none can be shown.
    expect(postedValues("label_ids")).toEqual([LABEL.id]);
  });
});
