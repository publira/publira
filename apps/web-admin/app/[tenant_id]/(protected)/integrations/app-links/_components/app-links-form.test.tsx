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
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FormActionState } from "#components/action-form";
import type { TenantMobileAppAssociation } from "#lib/tenant-mobile-app-association";

import { AppLinksForm } from "./app-links-form";

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
}));

const FINGERPRINT_A = Array.from({ length: 32 }, () => "AA").join(":");
const FINGERPRINT_B = Array.from({ length: 32 }, () => "BB").join(":");

const action = () => Promise.resolve(null);

const renderForm = (
  props: Partial<Parameters<typeof AppLinksForm>[0]> & {
    association: TenantMobileAppAssociation;
  }
) =>
  render(
    <AppLinksForm action={action} canEdit tenantId="TENANT001" {...props} />
  );

const platform = (name: string) => within(screen.getByRole("group", { name }));

/** A required field's name carries the label's asterisk after the label text. */
const control = (label: string) =>
  screen.getByRole<HTMLInputElement | HTMLTextAreaElement>("textbox", {
    name: new RegExp(`^${label}\\b`, "u"),
  });

// A control inside a disabled fieldset keeps its own `disabled` property false.
const isDisabled = (element: Element) => element.matches(":disabled");

const submittedControls = () => [
  platform("Android").getByRole("checkbox"),
  control("Application ID"),
  control("SHA-256 signing certificate fingerprints"),
  platform("iOS").getByRole("checkbox"),
  control("Apple Team ID"),
  control("Bundle identifier"),
];

/** A Base UI checkbox is a `<span>`, which says it is closed in ARIA instead. */
const isClosed = (element: Element) =>
  isDisabled(element) || element.getAttribute("aria-disabled") === "true";

afterEach(() => {
  cleanup();
});

describe("AppLinksForm", () => {
  // A disabled field submits nothing, which is how a save clears a platform.
  it("opens with both platforms off for a tenant with no app", () => {
    renderForm({ association: {} });

    expect(
      platform("Android")
        .getByRole("checkbox", {
          name: "Links open in the tenant's Android app",
        })
        .getAttribute("aria-checked")
    ).toBe("false");
    expect(isDisabled(control("Application ID"))).toBe(true);
    expect(isDisabled(control("Apple Team ID"))).toBe(true);
  });

  it("opens on the stored identities, one fingerprint per line", () => {
    renderForm({
      association: {
        android: {
          applicationId: "com.example.reader",
          sha256CertFingerprints: [FINGERPRINT_A, FINGERPRINT_B],
        },
        ios: { bundleIdentifier: "com.example.reader", teamId: "ABCDE12345" },
      },
    });

    expect(control("Application ID").value).toBe("com.example.reader");
    expect(control("SHA-256 signing certificate fingerprints").value).toBe(
      `${FINGERPRINT_A}\n${FINGERPRINT_B}`
    );
    expect(control("Apple Team ID").value).toBe("ABCDE12345");
    expect(control("Bundle identifier").value).toBe("com.example.reader");
    expect(isDisabled(control("Bundle identifier"))).toBe(false);
  });

  it("opens a platform's fields when its box is ticked", () => {
    renderForm({ association: {} });

    fireEvent.click(
      platform("iOS").getByRole("checkbox", {
        name: "Links open in the tenant's iOS app",
      })
    );

    expect(isDisabled(control("Apple Team ID"))).toBe(false);
    expect(isDisabled(control("Application ID"))).toBe(true);
  });

  it("closes every control while the stored identities could not be read", () => {
    renderForm({
      association: {},
      loadErrorMessage: "Could not load the app links. Please try again later.",
    });

    expect(
      screen.getByText("Could not load the app links. Please try again later.")
    ).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Save the app links",
      }).disabled
    ).toBe(true);
    expect(
      platform("Android").getByRole("checkbox").getAttribute("aria-disabled")
    ).toBe("true");
  });

  it("tells an operator without edit rights why the form is read-only", () => {
    renderForm({
      association: {
        ios: { bundleIdentifier: "com.example.reader", teamId: "ABCDE12345" },
      },
      canEdit: false,
    });

    expect(
      screen.getByText(
        "Only a tenant administrator can change this setting. You have read-only access."
      )
    ).toBeTruthy();
    expect(isDisabled(control("Apple Team ID"))).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Save the app links",
      }).disabled
    ).toBe(true);
  });

  // The Action carries what the form held when it was submitted, so an edit
  // made while it is in flight would sit under the success message unsaved.
  it("closes every control while the save is in flight", async () => {
    const save = Promise.withResolvers<FormActionState>();
    renderForm({
      action: () => save.promise,
      association: {
        android: {
          applicationId: "com.example.reader",
          sha256CertFingerprints: [FINGERPRINT_A],
        },
        ios: { bundleIdentifier: "com.example.reader", teamId: "ABCDE12345" },
      },
    });

    for (const element of submittedControls()) {
      expect(isClosed(element)).toBe(false);
    }

    fireEvent.click(screen.getByRole("button", { name: "Save the app links" }));

    await waitFor(() => {
      for (const element of submittedControls()) {
        expect(isClosed(element)).toBe(true);
      }
    });

    save.resolve(null);
    await waitFor(() => {
      expect(isClosed(control("Apple Team ID"))).toBe(false);
    });
  });
});
