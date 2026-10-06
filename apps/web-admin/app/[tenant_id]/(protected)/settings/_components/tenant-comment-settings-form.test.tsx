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

import type { TenantCommentSettingsActionState } from "../settings-types";
import { TenantCommentSettingsForm } from "./tenant-comment-settings-form";

const { save } = vi.hoisted(() => ({
  save: {
    current: Promise.withResolvers<TenantCommentSettingsActionState>(),
    formData: undefined as FormData | undefined,
  },
}));

vi.mock("../_lib/actions", () => ({
  updateTenantCommentSettingsAction: (_state: unknown, formData: FormData) => {
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

afterEach(() => {
  cleanup();
  // A submission left in flight would hold back the next test's transitions.
  save.current.resolve(null);
  save.current = Promise.withResolvers<TenantCommentSettingsActionState>();
  save.formData = undefined;
});

describe("TenantCommentSettingsForm", () => {
  it("offers the three modes and marks the saved one", async () => {
    await renderCard(
      <TenantCommentSettingsForm
        tenantId="TENANT001"
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
        tenantId="TENANT001"
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
        tenantId="TENANT001"
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
        tenantId="TENANT001"
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
    expect(thresholdInput().matches(":disabled")).toBe(true);
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
        tenantId="TENANT001"
        canEdit
        loadErrorMessage="Could not load the comment settings."
      />
    );

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.getAttribute("aria-disabled")).toBe("true");
    }
    expect(thresholdInput().matches(":disabled")).toBe(true);
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
    await renderCard(
      <TenantCommentSettingsForm
        tenantId="TENANT001"
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
    expect(thresholdInput().matches(":disabled")).toBe(false);

    fireEvent.click(submitButton());

    await waitFor(() => {
      for (const radio of screen.getAllByRole("radio")) {
        expect(radio.getAttribute("aria-disabled")).toBe("true");
      }
      expect(thresholdInput().matches(":disabled")).toBe(true);
    });
  });

  it("posts the picked mode and the typed threshold", async () => {
    await renderCard(
      <TenantCommentSettingsForm
        tenantId="TENANT001"
        canEdit
        initialSettings={{
          autoHideReportThreshold: 3,
          commentMode: "disabled",
        }}
      />
    );

    fireEvent.click(
      screen.getByRole("radio", { name: /Publish straight away/u })
    );
    fireEvent.change(thresholdInput(), { target: { value: "7" } });
    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(save.formData?.get("comment_mode")).toBe("immediate");
    });
    expect(save.formData?.get("auto_hide_report_threshold")).toBe("7");
    expect(save.formData?.get("tenant_id")).toBe("TENANT001");
  });

  // A successful save resets the form, which must leave the picked mode posted.
  it("posts the picked mode again after a save", async () => {
    await renderCard(
      <TenantCommentSettingsForm
        tenantId="TENANT001"
        canEdit
        initialSettings={{
          autoHideReportThreshold: 3,
          commentMode: "disabled",
        }}
      />
    );

    fireEvent.click(
      screen.getByRole("radio", { name: /Publish straight away/u })
    );
    fireEvent.click(submitButton());
    save.current.resolve({
      message: "The comment settings were saved.",
      ok: true,
    });
    await screen.findByText("The comment settings were saved.");

    save.current = Promise.withResolvers<TenantCommentSettingsActionState>();
    save.formData = undefined;
    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(save.formData?.get("comment_mode")).toBe("immediate");
    });
    expect(
      screen
        .getByRole("radio", { name: /Publish straight away/u })
        .getAttribute("aria-checked")
    ).toBe("true");
  });
});
