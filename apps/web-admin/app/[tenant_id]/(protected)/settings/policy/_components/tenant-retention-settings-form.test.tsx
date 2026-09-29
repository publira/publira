// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import type { FormActionState } from "@publira/ui-components/action-form";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";
import type { TenantRetentionPeriods } from "#lib/tenant-retention-settings";

import { TenantRetentionSettingsForm } from "./tenant-retention-settings-form";

const { save } = vi.hoisted(() => ({
  save: { current: Promise.withResolvers<FormActionState>() },
}));

vi.mock("../_lib/actions", () => ({
  updateTenantRetentionSettingsAction: () => save.current.promise,
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
}));

const platformDefaults: TenantRetentionPeriods = {
  contentEventDays: 90,
  dailyRankingSnapshotDays: 90,
  weeklyRankingSnapshotDays: 400,
  withdrawnCommentDays: 180,
};

const EnglishConsole = ({ children }: { children: ReactNode }) => (
  <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
);

const renderForm = async (ui: ReactNode) => {
  await act(() => {
    render(ui, { wrapper: EnglishConsole });
  });
  await screen.findByRole("button", { name: "Save the retention periods" });
};

/** One override group, by the heading its `<legend>` gives it. */
const group = (legend: string) =>
  within(screen.getByRole("group", { name: legend }));

const withdrawnComments = () => group("Withdrawn comments");

afterEach(() => {
  cleanup();
  save.current = Promise.withResolvers<FormActionState>();
});

describe("TenantRetentionSettingsForm", () => {
  it("shows a period with no override as following the platform default", async () => {
    await renderForm(
      <TenantRetentionSettingsForm
        canEdit
        overrides={{}}
        platformDefaults={platformDefaults}
        revision="0"
        tenantId="TENANT001"
      />
    );

    expect(
      withdrawnComments().getByText("Platform default: 180 days")
    ).toBeTruthy();
    expect(
      withdrawnComments()
        .getByRole("checkbox", { name: "Use the platform default" })
        .getAttribute("aria-checked")
    ).toBe("true");
  });

  // A control the tenant is not answering for is disabled, and a disabled
  // control submits nothing — which is how the save says "follow the platform
  // default" rather than writing the figure on screen as the tenant's own.
  it("leaves the entry of a period that follows the default out of the submission", async () => {
    await renderForm(
      <TenantRetentionSettingsForm
        canEdit
        overrides={{}}
        platformDefaults={platformDefaults}
        revision="0"
        tenantId="TENANT001"
      />
    );

    expect(
      withdrawnComments()
        .getByRole<HTMLInputElement>("spinbutton", {
          name: "Days kept",
        })
        .matches(":disabled")
    ).toBe(true);
  });

  it("shows the tenant's own period as its own, and opens it for editing", async () => {
    await renderForm(
      <TenantRetentionSettingsForm
        canEdit
        overrides={{ withdrawnCommentDays: 30 }}
        platformDefaults={platformDefaults}
        revision="4"
        tenantId="TENANT001"
      />
    );

    const days = withdrawnComments().getByRole<HTMLInputElement>("spinbutton", {
      name: "Days kept",
    });

    expect(
      withdrawnComments()
        .getByRole("checkbox", { name: "Use the platform default" })
        .getAttribute("aria-checked")
    ).toBe("false");
    expect(days.matches(":disabled")).toBe(false);
    expect(days.value).toBe("30");
  });

  it("returns a period to the platform default when the box is ticked again", async () => {
    await renderForm(
      <TenantRetentionSettingsForm
        canEdit
        overrides={{ withdrawnCommentDays: 30 }}
        platformDefaults={platformDefaults}
        revision="4"
        tenantId="TENANT001"
      />
    );

    fireEvent.click(
      withdrawnComments().getByRole("checkbox", {
        name: "Use the platform default",
      })
    );

    expect(
      withdrawnComments()
        .getByRole<HTMLInputElement>("spinbutton", {
          name: "Days kept",
        })
        .matches(":disabled")
    ).toBe(true);
  });

  it("closes every control while the stored periods could not be read", async () => {
    await renderForm(
      <TenantRetentionSettingsForm
        canEdit
        loadErrorMessage="Could not load the retention periods. Please try again later."
        overrides={{}}
        platformDefaults={platformDefaults}
        revision="0"
        tenantId="TENANT001"
      />
    );

    expect(
      withdrawnComments()
        .getByRole<HTMLInputElement>("spinbutton", {
          name: "Days kept",
        })
        .matches(":disabled")
    ).toBe(true);
    expect(
      screen
        .getByRole<HTMLButtonElement>("button", {
          name: "Save the retention periods",
        })
        .matches(":disabled")
    ).toBe(true);
  });

  it("tells an operator without edit rights why the form is read-only", async () => {
    await renderForm(
      <TenantRetentionSettingsForm
        canEdit={false}
        overrides={{}}
        platformDefaults={platformDefaults}
        revision="0"
        tenantId="TENANT001"
      />
    );

    expect(
      screen.getByText(
        "Only a tenant administrator can change this setting. You have read-only access."
      )
    ).toBeTruthy();
    expect(
      screen
        .getByRole<HTMLButtonElement>("button", {
          name: "Save the retention periods",
        })
        .matches(":disabled")
    ).toBe(true);
  });

  // The Action carries what the form held when it was submitted, so an edit
  // made while it is in flight would sit under the result unsaved.
  it("closes the periods while the save is in flight", async () => {
    await renderForm(
      <TenantRetentionSettingsForm
        canEdit
        overrides={{ withdrawnCommentDays: 30 }}
        platformDefaults={platformDefaults}
        revision="4"
        tenantId="TENANT001"
      />
    );

    const days = withdrawnComments().getByRole<HTMLInputElement>("spinbutton", {
      name: "Days kept",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Save the retention periods" })
    );

    await waitFor(() => {
      expect(days.matches(":disabled")).toBe(true);
    });

    save.current.resolve({ message: "Could not save.", ok: false });
    expect(await screen.findByText("Could not save.")).toBeTruthy();
    expect(days.matches(":disabled")).toBe(false);
    expect(days.value).toBe("30");
  });
});
