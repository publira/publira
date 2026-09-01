// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EpisodeAccessGate } from "./episode-access-gate";

// `<Message>` resolves the locale through `next/root-params`, which only the
// Next.js compiler can provide. The key it was handed is what this file is
// about, so rendering the key itself keeps the assertions readable.
vi.mock("#components/locale-provider", () => ({
  useLocale: () => "ja",
  useTenantDefaultLocale: () => "ja",
}));

vi.mock("#components/message", () => ({
  Message: ({ message }: { message: string }) => message,
}));

vi.mock("#components/locale-field", () => ({
  LocaleField: () => null,
}));

afterEach(cleanup);

const props = {
  episodePublicId: "EPISODE_001",
  seriesPublicId: "SERIES_001",
  signedIn: true,
  tenantId: "TENANT_001",
};

describe("EpisodeAccessGate", () => {
  it("Do not display purchase CTA if payment settings are disabled", () => {
    render(<EpisodeAccessGate {...props} acceptsPayments={false} />);

    expect(
      screen.queryByRole("button", {
        name: "host.episode.gate.purchase",
      })
    ).toBeNull();
    expect(
      screen.getByText("host.episode.gate.signed_in_unpayable_description")
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: "host.episode.to_series_detail" })
    ).toBeDefined();
  });

  it("Show purchase CTA if payment settings are enabled", () => {
    render(<EpisodeAccessGate {...props} acceptsPayments />);

    expect(
      screen.getByRole("button", { name: "host.episode.gate.purchase" })
    ).toBeDefined();
  });
});
