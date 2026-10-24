// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EpisodeAccessState } from "#lib/catalog";

import { EpisodeAccessReason } from "./episode-access-reason";

const { mockGetEpisodeViewer, mockResolveAccessToken } = vi.hoisted(() => ({
  mockGetEpisodeViewer: vi.fn(),
  mockResolveAccessToken: vi.fn(),
}));

// `<Message>` and `getLocale()` are async Server Components / root-parameter
// reads that only the Next.js compiler can provide. The catalog is the real
// one, so the assertions stay on the copy a reader actually sees.
vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

vi.mock("#lib/locale", () => ({
  getLocale: () => Promise.resolve("en"),
}));

vi.mock("#lib/api-client", () => ({
  resolveAccessToken: mockResolveAccessToken,
}));

vi.mock("#lib/catalog", () => ({
  getEpisodeViewer: mockGetEpisodeViewer,
}));

afterEach(cleanup);

const props = {
  checkoutSessionId: "",
  episodePublicId: "EP_010",
  seriesPublicId: "SERIES_001",
  tenantId: "TENANT_001",
};

const renderAccessReason = async (access: EpisodeAccessState = "locked") =>
  render(<div>{await EpisodeAccessReason({ ...props, access })}</div>);

describe("EpisodeAccessReason", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("session-token");
  });

  it("says the episode is open to its author", async () => {
    mockGetEpisodeViewer.mockResolvedValueOnce({
      ok: true,
      value: { access: "entitled", entitlementSource: "creator", images: [] },
    });

    await renderAccessReason();

    expect(screen.getByText("Open to you as its author")).toBeTruthy();
    expect(mockGetEpisodeViewer).toHaveBeenCalledWith(
      "TENANT_001",
      "SERIES_001",
      "EP_010",
      "session-token",
      "en",
      ""
    );
  });

  it("tells staff the episode is open through their role and that readers meet the gate", async () => {
    mockGetEpisodeViewer.mockResolvedValueOnce({
      ok: true,
      value: { access: "entitled", entitlementSource: "staff", images: [] },
    });

    await renderAccessReason();

    expect(
      screen.getByText(
        "Open to you through your staff role. Readers see a purchase prompt here."
      )
    ).toBeTruthy();
  });

  it("says nothing to a reader who bought the episode", async () => {
    mockGetEpisodeViewer.mockResolvedValueOnce({
      ok: true,
      value: { access: "entitled", entitlementSource: "purchase", images: [] },
    });

    const { container } = await renderAccessReason();

    expect(container.textContent).toBe("");
  });

  it("says nothing to a reader holding a ticket", async () => {
    mockGetEpisodeViewer.mockResolvedValueOnce({
      ok: true,
      value: {
        access: "entitled",
        entitlementSource: "access_ticket",
        images: [],
      },
    });

    const { container } = await renderAccessReason();

    expect(container.textContent).toBe("");
  });

  it("says nothing to a reader the episode is locked to", async () => {
    mockGetEpisodeViewer.mockResolvedValueOnce({
      ok: true,
      value: { access: "locked", images: [] },
    });

    const { container } = await renderAccessReason();

    expect(container.textContent).toBe("");
  });

  it("says nothing to a guest, without reading the body", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("");

    const { container } = await renderAccessReason();

    expect(container.textContent).toBe("");
    expect(mockGetEpisodeViewer).not.toHaveBeenCalled();
  });

  it("reads nothing for a body free to everyone", async () => {
    const { container } = await renderAccessReason("free");

    expect(container.textContent).toBe("");
    expect(mockResolveAccessToken).not.toHaveBeenCalled();
    expect(mockGetEpisodeViewer).not.toHaveBeenCalled();
  });

  it("leaves a failed read to the body", async () => {
    mockGetEpisodeViewer.mockResolvedValueOnce({
      message: "Could not load the episode.",
      ok: false,
    });

    const { container } = await renderAccessReason();

    expect(container.textContent).toBe("");
  });
});
