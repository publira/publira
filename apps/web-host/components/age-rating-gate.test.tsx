// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeConfirmedAgeRating } from "#lib/age-rating-confirmation";

import { AgeRatingGate } from "./age-rating-gate";

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "tenant-1",
}));

vi.mock("#components/locale-provider", () => ({
  useLocale: () => "en",
  useTenantDefaultLocale: () => "en",
}));

vi.mock("#components/client-message", () => ({
  ClientMessage: ({
    message,
    values,
  }: {
    message: string;
    values?: Record<string, string>;
  }) => (values?.title ? `${message}:${values.title}` : message),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: { children: ReactNode; href: string } & ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const renderGate = (rating?: "r15" | "r18") =>
  render(
    <AgeRatingGate
      backHref="/"
      backMessage="host.common.back_to_top"
      rating={rating}
      seriesTitle="Night Side"
    >
      <p>Series body</p>
    </AgeRatingGate>
  );

describe("AgeRatingGate", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("Shows the body of an unrestricted series without asking", () => {
    renderGate();

    expect(screen.getByText("Series body")).not.toBeNull();
    expect(
      screen.queryByText("host.series.age_gate.r18_title:Night Side")
    ).toBeNull();
  });

  it("Hides a rated body behind the confirmation", () => {
    renderGate("r18");

    expect(screen.queryByText("Series body")).toBeNull();
    expect(
      screen.getByText("host.series.age_gate.r18_title:Night Side")
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "host.series.age_gate.confirm_r18" })
    ).not.toBeNull();
    expect(
      screen.getByRole("link", { name: "host.common.back_to_top" })
    ).not.toBeNull();
  });

  it("Opens the body once the reader confirms", async () => {
    renderGate("r15");

    fireEvent.click(
      screen.getByRole("button", { name: "host.series.age_gate.confirm_r15" })
    );

    await waitFor(() => {
      expect(screen.getByText("Series body")).not.toBeNull();
    });
    expect(
      window.localStorage.getItem("publira.age-rating.confirmation.tenant-1")
    ).toBe("r15");
  });

  it("Opens an r15 series after an r18 confirmation already stored", async () => {
    writeConfirmedAgeRating("tenant-1", "r18");
    renderGate("r15");

    await waitFor(() => {
      expect(screen.getByText("Series body")).not.toBeNull();
    });
  });

  it("Keeps an r18 series closed after only an r15 confirmation", async () => {
    writeConfirmedAgeRating("tenant-1", "r15");
    renderGate("r18");

    await waitFor(() => {
      expect(
        screen.getByText("host.series.age_gate.r18_title:Night Side")
      ).not.toBeNull();
    });
    expect(screen.queryByText("Series body")).toBeNull();
  });
});
