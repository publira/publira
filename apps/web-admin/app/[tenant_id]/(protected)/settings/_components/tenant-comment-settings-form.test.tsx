// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TenantCommentSettingsActionState } from "../settings-types";
import { TenantCommentSettingsForm } from "./tenant-comment-settings-form";

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant_id: "TENANT001" }),
}));

const noopAction = vi.fn();

/**
 * Every string on the card is a `<ClientMessage>` that suspends on the catalog
 * it imports, so a render is awaited: `act` lets React flush the commit that
 * follows the `import()` instead of leaving the boundaries on their skeletons.
 */
const renderCard = async (ui: ReactNode) => {
  await act(() => {
    render(ui);
  });
  await screen.findByRole("button", { name: "Save the comment settings" });
};

const submitButton = () =>
  screen.getByRole<HTMLButtonElement>("button", {
    name: "Save the comment settings",
  });

const thresholdInput = () =>
  screen.getByRole<HTMLInputElement>("spinbutton", {
    name: "Reports that remove a comment",
  });

beforeEach(() => {
  // The language the console served this document in, which is what
  // `<ClientMessage>` falls back to when no locale cookie names one.
  document.documentElement.lang = "en";
});

afterEach(() => {
  cleanup();
  document.documentElement.lang = "";
});

describe("TenantCommentSettingsForm", () => {
  it("offers the three modes and marks the saved one", async () => {
    await renderCard(
      <TenantCommentSettingsForm
        action={noopAction}
        canEdit
        initialSettings={{
          autoHideReportThreshold: 3,
          commentMode: "approval_required",
        }}
      />
    );

    const radios = screen.getAllByRole("radio");

    expect(radios).toHaveLength(3);
    const approvalRadio = await screen.findByRole("radio", {
      name: /Publish after approval/u,
    });

    expect(approvalRadio.getAttribute("aria-checked")).toBe("true");
    expect(
      screen
        .getByRole("radio", { name: /Publish straight away/u })
        .getAttribute("aria-checked")
    ).toBe("false");
  });

  // Each mode says what a reader ends up experiencing, so the choice is not a
  // guess about what "approval" does to the storefront.
  it("explains what each mode means for readers", async () => {
    await renderCard(
      <TenantCommentSettingsForm
        action={noopAction}
        canEdit
        initialSettings={{
          autoHideReportThreshold: 3,
          commentMode: "disabled",
        }}
      />
    );

    expect(
      screen.getByText(
        "Episode pages show no comment section, and a comment cannot be posted."
      )
    ).toBeDefined();
    expect(
      screen.getByText(
        "A comment is readable by everyone from the moment it is posted."
      )
    ).toBeDefined();
    expect(
      screen.getByText(
        "Only its commenter sees a comment until a moderator approves it."
      )
    ).toBeDefined();
  });

  // The threshold shares the card and the save button with the mode, so it
  // starts from the stored value the same way the radio group does.
  it("shows the saved report threshold beside the mode", async () => {
    await renderCard(
      <TenantCommentSettingsForm
        action={noopAction}
        canEdit
        initialSettings={{
          autoHideReportThreshold: 5,
          commentMode: "immediate",
        }}
      />
    );

    expect(thresholdInput().value).toBe("5");
    expect(
      screen.getByText(/Enter 0 to leave every removal to your moderators\./u)
    ).toBeDefined();
  });

  it("stays read-only for someone who is not a tenant admin", async () => {
    await renderCard(
      <TenantCommentSettingsForm
        action={noopAction}
        canEdit={false}
        initialSettings={{
          autoHideReportThreshold: 3,
          commentMode: "immediate",
        }}
      />
    );

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.getAttribute("aria-disabled")).toBe("true");
    }
    expect(thresholdInput().disabled).toBe(true);
    expect(submitButton().disabled).toBe(true);
    expect(
      screen.getByText(
        "Only a tenant administrator can change this setting. You have read-only access."
      )
    ).toBeDefined();
  });

  it("blocks editing and shows the reason when the fetch fails", async () => {
    await renderCard(
      <TenantCommentSettingsForm
        action={noopAction}
        canEdit
        loadErrorMessage="Could not load the comment settings."
      />
    );

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.getAttribute("aria-disabled")).toBe("true");
    }
    expect(thresholdInput().disabled).toBe(true);
    expect(submitButton().disabled).toBe(true);
    expect(
      screen.getByText(/Could not load the comment settings./u)
    ).toBeDefined();
    expect(
      screen.getByText(/Saving now would overwrite the stored settings/u)
    ).toBeDefined();
  });

  // The Action carries what the form held when it was submitted, so a change
  // made while it is in flight would sit in the controls under the success
  // message while the tenant is still on the previous settings.
  it("closes the controls while the save is in flight", async () => {
    // Never resolved: the assertions are about the window the save is open in.
    const save = Promise.withResolvers<TenantCommentSettingsActionState>();
    const pendingAction = vi.fn(() => save.promise);

    await renderCard(
      <TenantCommentSettingsForm
        action={pendingAction}
        canEdit
        initialSettings={{
          autoHideReportThreshold: 3,
          commentMode: "disabled",
        }}
      />
    );

    // An enabled radio carries no `aria-disabled` at all rather than "false".
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.getAttribute("aria-disabled")).toBeNull();
    }
    expect(thresholdInput().disabled).toBe(false);

    fireEvent.click(submitButton());

    await waitFor(() => {
      for (const radio of screen.getAllByRole("radio")) {
        expect(radio.getAttribute("aria-disabled")).toBe("true");
      }
      expect(thresholdInput().disabled).toBe(true);
    });
  });
});
