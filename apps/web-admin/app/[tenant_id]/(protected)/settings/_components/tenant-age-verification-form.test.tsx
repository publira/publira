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

import type { TenantAgeVerificationActionState } from "../settings-types";
import { TenantAgeVerificationForm } from "./tenant-age-verification-form";

const { save } = vi.hoisted(() => ({
  save: {
    current: Promise.withResolvers<TenantAgeVerificationActionState>(),
    formData: undefined as FormData | undefined,
  },
}));

vi.mock("../_lib/actions", () => ({
  updateTenantAgeVerificationAction: (_state: unknown, formData: FormData) => {
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
  await screen.findByRole("button", { name: "Save the age verification" });
};

const submitButton = () =>
  screen.getByRole<HTMLButtonElement>("button", {
    name: "Save the age verification",
  });

afterEach(() => {
  cleanup();
  // A submission left in flight would hold back the next test's transitions.
  save.current.resolve(null);
  save.current = Promise.withResolvers<TenantAgeVerificationActionState>();
  save.formData = undefined;
});

describe("TenantAgeVerificationForm", () => {
  it("offers the three rules and marks the saved one", async () => {
    await renderCard(
      <TenantAgeVerificationForm
        tenantId="TENANT001"
        canEdit
        initialAgeVerification="r18"
      />
    );

    const radios = screen.getAllByRole("radio");

    expect(radios).toHaveLength(3);
    const r18Radio = await screen.findByRole("radio", {
      name: /Check R18 only/u,
    });

    expect(r18Radio.getAttribute("aria-checked")).toBe("true");
    expect(
      screen
        .getByRole("radio", { name: /Check no ages/u })
        .getAttribute("aria-checked")
    ).toBe("false");
  });

  // Each rule says which ratings end up closed to a reader who has proven
  // nothing, so the choice is not a guess about what "R18" does to the
  // storefront.
  it("explains what each rule means for readers", async () => {
    await renderCard(
      <TenantAgeVerificationForm
        tenantId="TENANT001"
        canEdit
        initialAgeVerification="none"
      />
    );

    expect(
      screen.getByText(
        "A rated series keeps its rating and still asks the reader to confirm, but no date of birth is asked for or checked."
      )
    ).toBeDefined();
    expect(
      screen.getByText(
        "An R18 series opens only to a reader who has proven they are 18, and an R15 series is left to the reader's own confirmation."
      )
    ).toBeDefined();
    expect(
      screen.getByText(
        "An R15 series opens only to a reader who has proven they are 15, and an R18 series only to one who has proven they are 18."
      )
    ).toBeDefined();
  });

  it("stays read-only for someone who is not a tenant admin", async () => {
    await renderCard(
      <TenantAgeVerificationForm
        tenantId="TENANT001"
        canEdit={false}
        initialAgeVerification="r18"
      />
    );

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.getAttribute("aria-disabled")).toBe("true");
    }
    expect(submitButton().disabled).toBe(true);
    expect(
      screen.getByText(
        "Only a tenant administrator can change this setting. You have read-only access."
      )
    ).toBeDefined();
  });

  it("blocks editing and shows the reason when the fetch fails", async () => {
    await renderCard(
      <TenantAgeVerificationForm
        tenantId="TENANT001"
        canEdit
        loadErrorMessage="Could not load the age verification."
      />
    );

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.getAttribute("aria-disabled")).toBe("true");
    }
    expect(submitButton().disabled).toBe(true);
    expect(
      screen.getByText(/Could not load the age verification./u)
    ).toBeDefined();
    expect(
      screen.getByText(/Saving now would overwrite the stored setting/u)
    ).toBeDefined();
  });

  // The Action carries what the form held when it was submitted, so a change
  // made while it is in flight would sit in the controls under the success
  // message while the tenant is still on the previous rule.
  it("closes the controls while the save is in flight", async () => {
    await renderCard(
      <TenantAgeVerificationForm
        tenantId="TENANT001"
        canEdit
        initialAgeVerification="none"
      />
    );

    // An enabled radio carries no `aria-disabled` at all rather than "false".
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.getAttribute("aria-disabled")).toBeNull();
    }

    fireEvent.click(submitButton());

    await waitFor(() => {
      for (const radio of screen.getAllByRole("radio")) {
        expect(radio.getAttribute("aria-disabled")).toBe("true");
      }
    });
  });

  it("posts the picked rule", async () => {
    await renderCard(
      <TenantAgeVerificationForm
        tenantId="TENANT001"
        canEdit
        initialAgeVerification="none"
      />
    );

    fireEvent.click(screen.getByRole("radio", { name: /Check R18 only/u }));
    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(save.formData?.get("age_verification")).toBe("r18");
    });
    expect(save.formData?.get("tenant_id")).toBe("TENANT001");
  });
});
