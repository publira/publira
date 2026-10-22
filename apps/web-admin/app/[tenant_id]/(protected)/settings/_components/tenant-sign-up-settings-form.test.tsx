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

import type { TenantSignUpSettingsActionState } from "../settings-types";
import { TenantSignUpSettingsForm } from "./tenant-sign-up-settings-form";

const { save } = vi.hoisted(() => ({
  save: {
    current: Promise.withResolvers<TenantSignUpSettingsActionState>(),
    formData: undefined as FormData | undefined,
  },
}));

vi.mock("../_lib/actions", () => ({
  updateTenantSignUpSettingsAction: (_state: unknown, formData: FormData) => {
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
  await screen.findByRole("button", { name: "Save the sign-up settings" });
};

const submitButton = () =>
  screen.getByRole<HTMLButtonElement>("button", {
    name: "Save the sign-up settings",
  });

const openSwitch = () =>
  screen.getByRole("switch", { name: "Accept new readers" });

const messageField = () =>
  screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Message while sign-up is closed",
  });

const closedNotice =
  /Sign-up is closed\. Nobody can create a new reader account/u;

afterEach(() => {
  cleanup();
  // A submission left in flight would hold back the next test's transitions.
  save.current.resolve(null);
  save.current = Promise.withResolvers<TenantSignUpSettingsActionState>();
  save.formData = undefined;
});

describe("TenantSignUpSettingsForm", () => {
  it("shows an open sign-up with no warning", async () => {
    await renderCard(
      <TenantSignUpSettingsForm
        canEdit
        initialSettings={{ closedMessage: "", signUpOpen: true }}
        tenantId="TENANT001"
      />
    );

    expect(openSwitch().getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText(closedNotice)).toBeNull();
  });

  // A switch thrown on purpose is easy to forget, so the card says in words
  // that nobody can sign up rather than leaving it to the switch's position.
  it("says plainly that nobody can sign up while sign-up is closed", async () => {
    await renderCard(
      <TenantSignUpSettingsForm
        canEdit
        initialSettings={{
          closedMessage: "We open again in spring.",
          signUpOpen: false,
        }}
        tenantId="TENANT001"
      />
    );

    expect(openSwitch().getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(closedNotice)).toBeDefined();
    expect(messageField().value).toBe("We open again in spring.");
  });

  it("tells the operator the site has a default notice and the bound it applies", async () => {
    await renderCard(
      <TenantSignUpSettingsForm
        canEdit
        initialSettings={{ closedMessage: "", signUpOpen: true }}
        tenantId="TENANT001"
      />
    );

    expect(
      screen.getByText(
        /up to 1,000 characters\. Leave it empty and the site shows a default notice/u
      )
    ).toBeDefined();
  });

  it("posts a closed sign-up and the typed message", async () => {
    await renderCard(
      <TenantSignUpSettingsForm
        canEdit
        initialSettings={{ closedMessage: "", signUpOpen: true }}
        tenantId="TENANT001"
      />
    );

    fireEvent.click(openSwitch());
    fireEvent.change(messageField(), {
      target: { value: "We open again in spring." },
    });
    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(save.formData?.get("closed_message")).toBe(
        "We open again in spring."
      );
    });
    expect(save.formData?.get("sign_up_open")).toBeNull();
    expect(save.formData?.get("tenant_id")).toBe("TENANT001");
  });

  it("posts an open sign-up while the switch is on", async () => {
    await renderCard(
      <TenantSignUpSettingsForm
        canEdit
        initialSettings={{ closedMessage: "Closed.", signUpOpen: false }}
        tenantId="TENANT001"
      />
    );

    fireEvent.click(openSwitch());
    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(save.formData?.get("sign_up_open")).toBe("on");
    });
  });

  it("shows the refusal of a message over the bound beside the field, keeping what was typed", async () => {
    await renderCard(
      <TenantSignUpSettingsForm
        canEdit
        initialSettings={{ closedMessage: "", signUpOpen: false }}
        tenantId="TENANT001"
      />
    );

    const tooLong = "a".repeat(1001);
    fireEvent.change(messageField(), { target: { value: tooLong } });
    fireEvent.click(submitButton());
    save.current.resolve({
      fieldErrors: {
        closedMessage: "Keep the message to 1,000 characters or fewer.",
      },
      message: "Keep the message to 1,000 characters or fewer.",
      ok: false,
    });

    await waitFor(() => {
      expect(
        screen.getAllByText("Keep the message to 1,000 characters or fewer.")
          .length
      ).toBeGreaterThan(0);
    });
    expect(messageField().value).toBe(tooLong);
  });

  it("stays read-only for someone who is not a tenant admin", async () => {
    await renderCard(
      <TenantSignUpSettingsForm
        canEdit={false}
        initialSettings={{ closedMessage: "Closed.", signUpOpen: false }}
        tenantId="TENANT001"
      />
    );

    expect(openSwitch().getAttribute("aria-disabled")).toBe("true");
    expect(messageField().matches(":disabled")).toBe(true);
    expect(submitButton().disabled).toBe(true);
    expect(screen.getByText(closedNotice)).toBeDefined();
    expect(
      screen.getByText(
        "Only a tenant administrator can change this setting. You have read-only access."
      )
    ).toBeDefined();
  });

  it("blocks editing and shows the reason when the fetch fails", async () => {
    await renderCard(
      <TenantSignUpSettingsForm
        canEdit
        loadErrorMessage="Could not load the sign-up settings."
        tenantId="TENANT001"
      />
    );

    expect(openSwitch().getAttribute("aria-disabled")).toBe("true");
    expect(messageField().matches(":disabled")).toBe(true);
    expect(submitButton().disabled).toBe(true);
    expect(screen.queryByText(closedNotice)).toBeNull();
    expect(
      screen.getByText(/Saving now would overwrite the stored settings/u)
    ).toBeDefined();
  });
});
