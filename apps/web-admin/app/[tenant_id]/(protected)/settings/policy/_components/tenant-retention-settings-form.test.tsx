// @vitest-environment jsdom

import { sharedCatalog } from "@publira/i18n/catalog";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";
import type { TenantRetentionPeriods } from "#lib/tenant-retention-settings";

import { TenantRetentionSettingsForm } from "./tenant-retention-settings-form";

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant_id: "TENANT001" }),
}));

const noopAction = vi.fn();

const platformDefaults: TenantRetentionPeriods = {
  contentEventDays: 90,
  dailyRankingSnapshotDays: 90,
  weeklyRankingSnapshotDays: 400,
  withdrawnCommentDays: 180,
};

const EnglishConsole = ({ children }: { children: ReactNode }) => (
  <AdminLocaleProvider locale="en" messages={sharedCatalog("en")}>
    {children}
  </AdminLocaleProvider>
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
});

describe("TenantRetentionSettingsForm", () => {
  it("shows a period with no override as following the platform default", async () => {
    await renderForm(
      <TenantRetentionSettingsForm
        action={noopAction}
        canEdit
        overrides={{}}
        platformDefaults={platformDefaults}
        revision="0"
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
        action={noopAction}
        canEdit
        overrides={{}}
        platformDefaults={platformDefaults}
        revision="0"
      />
    );

    expect(
      withdrawnComments().getByRole<HTMLInputElement>("spinbutton", {
        name: "Days kept",
      }).disabled
    ).toBe(true);
  });

  it("shows the tenant's own period as its own, and opens it for editing", async () => {
    await renderForm(
      <TenantRetentionSettingsForm
        action={noopAction}
        canEdit
        overrides={{ withdrawnCommentDays: 30 }}
        platformDefaults={platformDefaults}
        revision="4"
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
    expect(days.disabled).toBe(false);
    expect(days.value).toBe("30");
  });

  it("returns a period to the platform default when the box is ticked again", async () => {
    await renderForm(
      <TenantRetentionSettingsForm
        action={noopAction}
        canEdit
        overrides={{ withdrawnCommentDays: 30 }}
        platformDefaults={platformDefaults}
        revision="4"
      />
    );

    fireEvent.click(
      withdrawnComments().getByRole("checkbox", {
        name: "Use the platform default",
      })
    );

    expect(
      withdrawnComments().getByRole<HTMLInputElement>("spinbutton", {
        name: "Days kept",
      }).disabled
    ).toBe(true);
  });

  it("closes every control while the stored periods could not be read", async () => {
    await renderForm(
      <TenantRetentionSettingsForm
        action={noopAction}
        canEdit
        loadErrorMessage="Could not load the retention periods. Please try again later."
        overrides={{}}
        platformDefaults={platformDefaults}
        revision="0"
      />
    );

    expect(
      withdrawnComments().getByRole<HTMLInputElement>("spinbutton", {
        name: "Days kept",
      }).disabled
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Save the retention periods",
      }).disabled
    ).toBe(true);
  });

  it("tells an operator without edit rights why the form is read-only", async () => {
    await renderForm(
      <TenantRetentionSettingsForm
        action={noopAction}
        canEdit={false}
        overrides={{}}
        platformDefaults={platformDefaults}
        revision="0"
      />
    );

    expect(
      screen.getByText(
        "Only a tenant administrator can change this setting. You have read-only access."
      )
    ).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Save the retention periods",
      }).disabled
    ).toBe(true);
  });
});
