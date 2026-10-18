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

import type { SiteSettingsActionState } from "../settings-types";
import { SiteSettingsFields } from "./site-settings-form";

const { save } = vi.hoisted(() => ({
  save: { current: Promise.withResolvers<SiteSettingsActionState>() },
}));

vi.mock("../_lib/actions", () => ({
  updateSiteSettingsAction: () => save.current.promise,
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

vi.mock("#lib/get-messages", () => ({
  getMessages: () => Promise.resolve(bindMessages(sharedCatalog("en"), "en")),
}));

const settings = {
  copyrightText: "Copyright © 2026 Acme Inc.",
  siteDescription: "News and release announcements.",
  siteTagline: "Read quietly",
};

const fields = () => [
  screen.getByRole<HTMLInputElement>("textbox", { name: "Copyright notice" }),
  screen.getByRole<HTMLInputElement>("textbox", { name: "Site tagline" }),
  screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Site description",
  }),
];

afterEach(() => {
  cleanup();
  // A submission left in flight would hold back the next test's transitions.
  save.current.resolve(null);
  save.current = Promise.withResolvers<SiteSettingsActionState>();
});

describe("SiteSettingsFields", () => {
  it("shows the saved settings", async () => {
    render(
      await SiteSettingsFields({
        canEdit: true,
        settings,
        tenantId: "TENANT001",
        translationLocale: "en",
      })
    );

    expect(fields().map((field) => field.value)).toStrictEqual([
      "Copyright © 2026 Acme Inc.",
      "Read quietly",
      "News and release announcements.",
    ]);
  });

  it("sends the language of its tab with the copy", async () => {
    const { container } = render(
      await SiteSettingsFields({
        canEdit: true,
        settings,
        tenantId: "TENANT001",
        translationLocale: "en",
      })
    );

    expect(
      container.querySelector<HTMLInputElement>(
        'input[name="translation_locale"]'
      )?.value
    ).toBe("en");
  });

  it("sends no language from a card without tabs", async () => {
    const { container } = render(
      await SiteSettingsFields({
        canEdit: true,
        settings,
        tenantId: "TENANT001",
        translationLocale: undefined,
      })
    );

    expect(
      container.querySelector<HTMLInputElement>(
        'input[name="translation_locale"]'
      )?.value
    ).toBe("");
  });

  // The Action carries what the fields held when the form was submitted, so an
  // edit made while it is in flight would sit under the success message unsaved.
  it("closes the fields while the save is in flight", async () => {
    render(
      await SiteSettingsFields({
        canEdit: true,
        settings,
        tenantId: "TENANT001",
        translationLocale: "en",
      })
    );

    for (const field of fields()) {
      expect(field.matches(":disabled")).toBe(false);
    }

    fireEvent.click(screen.getByRole("button", { name: "Save the settings" }));

    await waitFor(() => {
      for (const field of fields()) {
        expect(field.matches(":disabled")).toBe(true);
      }
    });

    save.current.resolve({ message: "Could not save.", ok: false });
    expect(await screen.findByText("Could not save.")).toBeDefined();
    expect(fields()[0].matches(":disabled")).toBe(false);
  });

  it("stays read-only for someone who is not a tenant admin", async () => {
    render(
      await SiteSettingsFields({
        canEdit: false,
        settings,
        tenantId: "TENANT001",
        translationLocale: "en",
      })
    );

    for (const field of fields()) {
      expect(field.matches(":disabled")).toBe(true);
    }
    expect(
      screen
        .getByRole<HTMLButtonElement>("button", { name: "Save the settings" })
        .matches(":disabled")
    ).toBe(true);
    expect(
      screen.getByText(
        "Only a tenant administrator can change this setting. You have read-only access."
      )
    ).toBeTruthy();
  });
});
