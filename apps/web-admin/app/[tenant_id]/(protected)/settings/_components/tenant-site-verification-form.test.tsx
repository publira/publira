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
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import type { TenantSiteVerificationActionState } from "../settings-types";
import { TenantSiteVerificationForm } from "./tenant-site-verification-form";

const { save } = vi.hoisted(() => ({
  save: {
    current: Promise.withResolvers<TenantSiteVerificationActionState>(),
    formData: undefined as FormData | undefined,
  },
}));

vi.mock("../_lib/actions", () => ({
  updateTenantSiteVerificationAction: (_state: unknown, formData: FormData) => {
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

const SUBMIT = "Save the verification codes";
const ADMIN_ONLY =
  "Only a tenant administrator can change this setting. You have read-only access.";
const INVALID =
  "Paste the whole <meta> tag, or only its content value: up to 128 letters, digits, hyphens, and underscores.";

const renderForm = (
  props: Partial<Parameters<typeof TenantSiteVerificationForm>[0]> = {}
) =>
  render(
    <AdminLocaleTestProvider locale="en">
      <TenantSiteVerificationForm
        canEdit
        initialSiteVerification={{ bing: "", google: "aBc-123" }}
        tenantId="TENANT001"
        {...props}
      />
    </AdminLocaleTestProvider>
  );

const googleField = () =>
  screen.getByRole<HTMLInputElement>("textbox", {
    name: "Google Search Console",
  });

const bingField = () =>
  screen.getByRole<HTMLInputElement>("textbox", {
    name: "Bing Webmaster Tools",
  });

const submitButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: SUBMIT });

// A control inside a disabled fieldset keeps its own `disabled` property false.
const isDisabled = (element: HTMLElement) =>
  element.matches(":disabled") ||
  element.getAttribute("aria-disabled") === "true" ||
  Object.hasOwn(element.dataset, "disabled");

afterEach(() => {
  cleanup();
  // A submission left in flight would hold back the next test's transitions.
  save.current.resolve(null);
  save.current = Promise.withResolvers<TenantSiteVerificationActionState>();
  save.formData = undefined;
});

describe("TenantSiteVerificationForm", () => {
  it("opens on the saved codes", () => {
    renderForm();

    expect(googleField().value).toBe("aBc-123");
    expect(bingField().value).toBe("");
    expect(submitButton().disabled).toBe(false);
  });

  // The API answers the codes to a tenant administrator alone.
  it("shows empty fields read-only to an operator who is not an administrator", () => {
    renderForm({ canEdit: false, initialSiteVerification: undefined });

    expect(screen.getByText(ADMIN_ONLY)).toBeTruthy();
    expect(googleField().value).toBe("");
    expect(isDisabled(googleField())).toBe(true);
    expect(isDisabled(bingField())).toBe(true);
    expect(submitButton().disabled).toBe(true);
  });

  // A save writes both codes, so one sent without the stored codes would clear
  // them.
  it("closes every control while the stored codes could not be read", () => {
    renderForm({
      initialSiteVerification: undefined,
      loadErrorMessage:
        "Could not load the verification codes. Please try again later.",
    });

    expect(
      screen.getByText(
        "Could not load the verification codes. Please try again later."
      )
    ).toBeTruthy();
    expect(isDisabled(googleField())).toBe(true);
    expect(submitButton().disabled).toBe(true);
  });

  it("shows the stored codes once a read that failed recovers, so a save does not clear them", () => {
    const { rerender } = renderForm({
      initialSiteVerification: undefined,
      loadErrorMessage:
        "Could not load the verification codes. Please try again later.",
    });

    expect(googleField().value).toBe("");

    rerender(
      <AdminLocaleTestProvider locale="en">
        <TenantSiteVerificationForm
          canEdit
          initialSiteVerification={{ bing: "0123ABCD", google: "aBc-123" }}
          tenantId="TENANT001"
        />
      </AdminLocaleTestProvider>
    );

    expect(googleField().value).toBe("aBc-123");
    expect(bingField().value).toBe("0123ABCD");
    expect(submitButton().disabled).toBe(false);
  });

  it("replaces a pasted <meta> element with its content value once the field is left", () => {
    renderForm();

    fireEvent.change(bingField(), {
      target: { value: '<meta name="msvalidate.01" content="0123ABCD" />' },
    });
    fireEvent.focusOut(bingField());

    expect(bingField().value).toBe("0123ABCD");
    expect(bingField().getAttribute("aria-invalid")).toBeNull();
  });

  it("names a value that is not a code once its field is left", () => {
    renderForm();

    fireEvent.change(googleField(), { target: { value: "aBc 123" } });
    expect(screen.queryByText(INVALID)).toBeNull();

    fireEvent.focusOut(googleField());

    expect(screen.getByText(INVALID)).toBeTruthy();
    expect(googleField().getAttribute("aria-invalid")).toBe("true");
    expect(googleField().value).toBe("aBc 123");

    fireEvent.change(googleField(), { target: { value: "aBc-123" } });

    expect(screen.queryByText(INVALID)).toBeNull();
  });

  it("names the other service's element rather than reading it", () => {
    renderForm();

    fireEvent.change(bingField(), {
      target: {
        value: '<meta name="google-site-verification" content="aBc-123" />',
      },
    });
    fireEvent.focusOut(bingField());

    expect(
      screen.getByText(
        "This is not a msvalidate.01 tag. Copy the tag this service shows."
      )
    ).toBeTruthy();
  });

  it("submits both fields and then shows the codes as stored", async () => {
    renderForm();

    fireEvent.change(googleField(), { target: { value: "" } });
    fireEvent.change(bingField(), {
      target: { value: '<meta name="msvalidate.01" content="0123ABCD" />' },
    });
    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(save.formData).toBeDefined();
    });
    expect(save.formData?.get("google_site_verification")).toBe("");
    expect(save.formData?.get("bing_site_verification")).toBe(
      '<meta name="msvalidate.01" content="0123ABCD" />'
    );

    save.current.resolve({
      message: "The verification codes were saved.",
      ok: true,
      siteVerification: { bing: "0123ABCD", google: "" },
    });

    await waitFor(() => {
      expect(bingField().value).toBe("0123ABCD");
    });
    expect(googleField().value).toBe("");
    expect(
      await screen.findByText("The verification codes were saved.")
    ).toBeTruthy();
  });

  it("shows the server's refusal beside the field it refused and keeps what was typed", async () => {
    renderForm();

    fireEvent.change(bingField(), { target: { value: "0123ABCD" } });
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(save.formData).toBeDefined();
    });
    save.current.resolve({
      fieldErrors: { bing: INVALID },
      message: INVALID,
      ok: false,
    });

    await waitFor(() => {
      expect(bingField().getAttribute("aria-invalid")).toBe("true");
    });
    expect(screen.getAllByText(INVALID).length).toBeGreaterThan(0);
    expect(bingField().value).toBe("0123ABCD");
    expect(googleField().getAttribute("aria-invalid")).toBeNull();
  });
});
