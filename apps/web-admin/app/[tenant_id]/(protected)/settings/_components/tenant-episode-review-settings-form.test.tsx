// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TenantEpisodeReviewSettingsActionState } from "../settings-types";
import { TenantEpisodeReviewSettingsForm } from "./tenant-episode-review-settings-form";

/** The answer the mocked Action gives, and the form it was submitted. */
interface PendingSubmission {
  current: PromiseWithResolvers<TenantEpisodeReviewSettingsActionState>;
  formData?: FormData;
}

const { save } = vi.hoisted(() => {
  const submission: PendingSubmission = {
    current: Promise.withResolvers<TenantEpisodeReviewSettingsActionState>(),
  };

  return { save: submission };
});

vi.mock("../_lib/actions", () => ({
  updateTenantEpisodeReviewSettingsAction: (
    _state: TenantEpisodeReviewSettingsActionState,
    formData: FormData
  ) => {
    save.formData = formData;

    return save.current.promise;
  },
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

const renderCard = async (ui: ReactNode) => {
  render(ui);
  await screen.findByRole("button", { name: "Save the review setting" });
};

const submitButton = () =>
  screen.getByRole<HTMLButtonElement>("button", {
    name: "Save the review setting",
  });

const requiredBox = () =>
  screen.getByRole("checkbox", { name: "Require review before publishing" });

afterEach(() => {
  cleanup();
  // A submission left in flight would hold back the next test's transitions.
  save.current.resolve(null);
  save.current =
    Promise.withResolvers<TenantEpisodeReviewSettingsActionState>();
  save.formData = undefined;
});

describe("TenantEpisodeReviewSettingsForm", () => {
  it.each([
    [true, "true"],
    [false, "false"],
  ])("marks the saved choice %s", async (required, checked) => {
    await renderCard(
      <TenantEpisodeReviewSettingsForm
        canEdit
        initialEpisodeReviewRequired={required}
        tenantId="TENANT001"
      />
    );

    expect(requiredBox().ariaChecked).toBe(checked);
  });

  it("posts review on once the box is ticked", async () => {
    await renderCard(
      <TenantEpisodeReviewSettingsForm
        canEdit
        initialEpisodeReviewRequired={false}
        tenantId="TENANT001"
      />
    );

    fireEvent.click(requiredBox());
    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(save.formData?.get("episode_review_required")).toBe("on");
    });
    expect(save.formData?.get("tenant_id")).toBe("TENANT001");
  });

  it("stays read-only for someone who is not a tenant admin", async () => {
    await renderCard(
      <TenantEpisodeReviewSettingsForm
        canEdit={false}
        initialEpisodeReviewRequired
        tenantId="TENANT001"
      />
    );

    expect(requiredBox().getAttribute("aria-disabled")).toBe("true");
    expect(submitButton().disabled).toBe(true);
    expect(
      screen.getByText(
        "Only a tenant administrator can change this setting. You have read-only access."
      )
    ).toBeDefined();
  });

  // Saving without the stored choice would turn review off over a tenant
  // that requires it.
  it("blocks editing and shows the reason when the read fails", async () => {
    await renderCard(
      <TenantEpisodeReviewSettingsForm
        canEdit
        loadErrorMessage="Could not load the review setting."
        tenantId="TENANT001"
      />
    );

    expect(requiredBox().getAttribute("aria-disabled")).toBe("true");
    expect(submitButton().disabled).toBe(true);
    expect(
      screen.getByText(/Saving now would overwrite the stored setting/u)
    ).toBeDefined();
  });
});
