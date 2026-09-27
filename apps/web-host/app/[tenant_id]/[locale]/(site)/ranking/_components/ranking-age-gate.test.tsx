// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RankingAgeGate } from "./ranking-age-gate";

// `<Message>` resolves the locale through `next/root-params`, which only the
// Next.js compiler can provide. The key it was handed is what this file is
// about, so rendering the key itself keeps the assertions readable.
vi.mock("#components/locale-provider", () => ({
  useLocale: () => "en",
  useTenantDefaultLocale: () => "en",
}));

vi.mock("#components/message", () => ({
  Message: ({ message }: { message: string }) => message,
}));

afterEach(cleanup);

const props = { period: "weekly", rating: "r18" } as const;

describe("RankingAgeGate", () => {
  it("sends a guest to sign in and back to the ranking they asked for", () => {
    render(<RankingAgeGate {...props} hasBirthDate={false} signedIn={false} />);

    expect(
      screen.getByText("host.ranking.age_gate.guest_description")
    ).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "host.ranking.age_gate.login" })
        .getAttribute("href")
    ).toContain(
      `returnTo=${encodeURIComponent("/ranking?period=weekly&rating=r18")}`
    );
  });

  it("sends a reader who has given no date to their settings", () => {
    render(<RankingAgeGate {...props} hasBirthDate={false} signedIn />);

    expect(
      screen.getByText("host.ranking.age_gate.no_birth_date_description")
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: "host.ranking.age_gate.add_birth_date" })
    ).toBeDefined();
  });

  it("offers only the all-ages ranking to a reader whose own date stops them", () => {
    render(<RankingAgeGate {...props} hasBirthDate signedIn />);

    expect(
      screen.getByText("host.ranking.age_gate.too_young_description")
    ).toBeDefined();
    expect(
      screen.queryByRole("link", {
        name: "host.ranking.age_gate.add_birth_date",
      })
    ).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "host.ranking.back_to_all_ages" })
        .getAttribute("href")
    ).toMatch(/\/ranking\?period=weekly$/u);
  });
});
