// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnnouncementItem } from "../announcement-types";
import { AnnouncementFormData } from "./announcement-form-data";

const { mockFindTenantLocales } = vi.hoisted(() => ({
  mockFindTenantLocales: vi.fn(),
}));

vi.mock("#lib/tenant-locales", () => ({
  findTenantLocales: mockFindTenantLocales,
}));

vi.mock("#lib/tenant-timezone", () => ({
  getTenantDisplayTimeZone: () => Promise.resolve("UTC"),
}));

vi.mock("#lib/series", () => ({
  listAllSeries: () => Promise.resolve({ ok: true, series: [] }),
}));

vi.mock("#lib/subscription-plan", () => ({
  listSubscriptionPlans: () => Promise.resolve({ ok: true, plans: [] }),
}));

vi.mock("#lib/auth-session", () => ({
  isSignedInTenantAdmin: () => Promise.resolve(true),
}));

vi.mock("#lib/locale", () => ({ getLocale: () => Promise.resolve("en") }));

vi.mock("#lib/messages", () => ({
  getMessagesFor: () =>
    Promise.resolve(bindMessages(sharedCatalog("en"), "en")),
}));

vi.mock("#components/message", () => ({
  Message: ({ message }: { message: MessageKey<SharedMessages> }) =>
    bindMessages(sharedCatalog("en"), "en")(message),
}));

// The form itself is the subject of its own tests; here it only says it was
// rendered and for which announcement.
vi.mock("./announcement-form", () => ({
  AnnouncementForm: ({ announcement }: { announcement?: { id: string } }) => (
    <p>Form for {announcement?.id ?? "a new announcement"}</p>
  ),
}));

const scheduled: AnnouncementItem = {
  audience: null,
  body: "A new chapter goes out on Monday.",
  createdAt: "2099-05-29T00:00:00Z",
  deliverAt: "2099-06-01T00:00:00Z",
  deliveredAt: "",
  delivery: "preferred",
  id: "018f0f90-0001-7000-8000-000000000101",
  linkUrl: "",
  pinned: false,
  pinnedUntil: "",
  title: "Coming on Monday",
  translatedLocales: ["en", "ja"],
  translations: [
    {
      body: "A new chapter goes out on Monday.",
      locale: "en",
      title: "Coming on Monday",
    },
    {
      body: "A new chapter goes out on Monday (Japanese).",
      locale: "ja",
      title: "Coming on Monday (Japanese)",
    },
  ],
};

beforeEach(() => {
  mockFindTenantLocales.mockResolvedValue({
    defaultLocale: "en",
    supportedLocales: ["en", "ja"],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AnnouncementFormData", () => {
  it("opens a scheduled announcement for editing once the site's languages are read", async () => {
    render(
      await AnnouncementFormData({
        action: vi.fn(),
        announcement: scheduled,
        tenantId: "TENANT001",
      })
    );

    expect(screen.getByText(`Form for ${scheduled.id}`)).toBeDefined();
  });

  // A save replaces every translation with what the form posts, and without
  // the languages the form would post the default one alone.
  it("does not open the edit form when the site's languages cannot be read", async () => {
    mockFindTenantLocales.mockResolvedValue(null);

    render(
      await AnnouncementFormData({
        action: vi.fn(),
        announcement: scheduled,
        tenantId: "TENANT001",
      })
    );

    expect(screen.queryByText(`Form for ${scheduled.id}`)).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "Could not open the announcement for editing"
    );
  });

  it("still opens the create form in the default language alone when the languages cannot be read", async () => {
    mockFindTenantLocales.mockResolvedValue(null);

    render(
      await AnnouncementFormData({ action: vi.fn(), tenantId: "TENANT001" })
    );

    expect(screen.getByText("Form for a new announcement")).toBeDefined();
  });
});
