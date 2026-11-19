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

import type { TenantCreatorPageSettingsActionState } from "../settings-types";
import { TenantCreatorPageSettingsForm } from "./tenant-creator-page-settings-form";

/** The answer the mocked Action gives, and the form it was submitted. */
interface PendingSubmission {
  current: PromiseWithResolvers<TenantCreatorPageSettingsActionState>;
  formData?: FormData;
}

const { save } = vi.hoisted(() => {
  const submission: PendingSubmission = {
    current: Promise.withResolvers<TenantCreatorPageSettingsActionState>(),
  };

  return { save: submission };
});

vi.mock("../_lib/actions", () => ({
  updateTenantCreatorPageSettingsAction: (
    _state: TenantCreatorPageSettingsActionState,
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
  await screen.findByRole("button", {
    name: "Save the author page settings",
  });
};

const submitButton = () =>
  screen.getByRole<HTMLButtonElement>("button", {
    name: "Save the author page settings",
  });

const pagesBox = () =>
  screen.getByRole("checkbox", { name: "Show Authors their own pages" });

const salesBox = () =>
  screen.getByRole("checkbox", {
    name: "Show statements and sales figures",
  });

afterEach(() => {
  cleanup();
  // A submission left in flight would hold back the next test's transitions.
  save.current.resolve(null);
  save.current = Promise.withResolvers<TenantCreatorPageSettingsActionState>();
  save.formData = undefined;
});

describe("TenantCreatorPageSettingsForm", () => {
  it("marks the saved switches", async () => {
    await renderCard(
      <TenantCreatorPageSettingsForm
        tenantId="TENANT001"
        canEdit
        initialSettings={{
          creatorPagesEnabled: true,
          creatorPagesShowSales: false,
        }}
      />
    );

    expect(pagesBox().ariaChecked).toBe("true");
    expect(salesBox().ariaChecked).toBe("false");
  });

  // The second box is the statements and the sales fields together, and it
  // can be on while the pages stay off, so each box says what it does on its
  // own.
  it("explains the two switches", async () => {
    await renderCard(
      <TenantCreatorPageSettingsForm
        tenantId="TENANT001"
        canEdit
        initialSettings={{
          creatorPagesEnabled: false,
          creatorPagesShowSales: false,
        }}
      />
    );

    expect(
      screen.getByText(
        /A linked reader can open each Author they are linked to/u
      )
    ).toBeDefined();
    expect(
      screen.getByText(/This can be saved while the pages are off/u)
    ).toBeDefined();
  });

  it("stays read-only for someone who is not a tenant admin", async () => {
    await renderCard(
      <TenantCreatorPageSettingsForm
        tenantId="TENANT001"
        canEdit={false}
        initialSettings={{
          creatorPagesEnabled: true,
          creatorPagesShowSales: true,
        }}
      />
    );

    expect(pagesBox().getAttribute("aria-disabled")).toBe("true");
    expect(salesBox().getAttribute("aria-disabled")).toBe("true");
    expect(submitButton().disabled).toBe(true);
    expect(
      screen.getByText(
        "Only a tenant administrator can change this setting. You have read-only access."
      )
    ).toBeDefined();
  });

  it("blocks editing and shows the reason when the fetch fails", async () => {
    await renderCard(
      <TenantCreatorPageSettingsForm
        tenantId="TENANT001"
        canEdit
        loadErrorMessage="Could not load the author page settings."
      />
    );

    expect(pagesBox().getAttribute("aria-disabled")).toBe("true");
    expect(salesBox().getAttribute("aria-disabled")).toBe("true");
    expect(submitButton().disabled).toBe(true);
    expect(
      screen.getByText(/Could not load the author page settings/u)
    ).toBeDefined();
    expect(
      screen.getByText(/Saving now would overwrite the stored settings/u)
    ).toBeDefined();
  });

  // The Action carries what the form held when it was submitted, so a change
  // made while it is in flight would sit in the boxes under the success
  // message while the tenant is still on the previous switches.
  it("closes the controls while the save is in flight", async () => {
    await renderCard(
      <TenantCreatorPageSettingsForm
        tenantId="TENANT001"
        canEdit
        initialSettings={{
          creatorPagesEnabled: false,
          creatorPagesShowSales: false,
        }}
      />
    );

    // An enabled box carries no `aria-disabled` at all rather than "false".
    expect(pagesBox().getAttribute("aria-disabled")).toBeNull();
    expect(salesBox().getAttribute("aria-disabled")).toBeNull();

    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(pagesBox().getAttribute("aria-disabled")).toBe("true");
      expect(salesBox().getAttribute("aria-disabled")).toBe("true");
    });
  });

  // Sales on while the pages stay off is a choice the tenant can record. The
  // pages show nothing until they are turned on.
  it("posts sales on while the pages stay off", async () => {
    await renderCard(
      <TenantCreatorPageSettingsForm
        tenantId="TENANT001"
        canEdit
        initialSettings={{
          creatorPagesEnabled: false,
          creatorPagesShowSales: false,
        }}
      />
    );

    fireEvent.click(salesBox());
    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(save.formData?.get("creator_pages_show_sales")).toBe("on");
    });
    expect(save.formData?.get("creator_pages_enabled")).toBeNull();
    expect(save.formData?.get("tenant_id")).toBe("TENANT001");
  });

  it("posts both switches when both are on", async () => {
    await renderCard(
      <TenantCreatorPageSettingsForm
        tenantId="TENANT001"
        canEdit
        initialSettings={{
          creatorPagesEnabled: false,
          creatorPagesShowSales: false,
        }}
      />
    );

    fireEvent.click(pagesBox());
    fireEvent.click(salesBox());
    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(save.formData?.get("creator_pages_enabled")).toBe("on");
    });
    expect(save.formData?.get("creator_pages_show_sales")).toBe("on");
  });
});
