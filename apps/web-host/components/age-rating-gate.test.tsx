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

import {
  AgeRatingGate,
  AgeRatingGateActions,
  AgeRatingGateBack,
  AgeRatingGateConfirm,
  AgeRatingGateConfirmation,
  AgeRatingGateContent,
  AgeRatingGateDescription,
  AgeRatingGateHeading,
  AgeRatingGateTitle,
} from "./age-rating-gate";

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "tenant-1",
}));

vi.mock("#components/locale-provider", () => ({
  useLocale: () => "en",
  useTenantDefaultLocale: () => "en",
}));

vi.mock("#components/client-message", () => ({
  ClientMessage: ({ message }: { message: string }) => message,
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

const title = "“Night Side” is age-rated";

const renderGate = (rating?: "r15" | "r18", proven?: "r15" | "r18") =>
  render(
    <AgeRatingGate provenAgeRating={proven} rating={rating}>
      <AgeRatingGateConfirmation>
        <AgeRatingGateHeading>
          <AgeRatingGateTitle>{title}</AgeRatingGateTitle>
          <AgeRatingGateDescription />
        </AgeRatingGateHeading>
        <AgeRatingGateActions>
          <AgeRatingGateConfirm />
          <AgeRatingGateBack href="/">Back to home</AgeRatingGateBack>
        </AgeRatingGateActions>
      </AgeRatingGateConfirmation>
      <AgeRatingGateContent>
        <p>Series body</p>
      </AgeRatingGateContent>
    </AgeRatingGate>
  );

describe("AgeRatingGate", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("Shows the body of an unrestricted series without asking", () => {
    renderGate();

    expect(screen.getByText("Series body")).not.toBeNull();
    expect(screen.queryByText(title)).toBeNull();
  });

  it("Hides a rated body behind the confirmation", () => {
    renderGate("r18");

    expect(screen.queryByText("Series body")).toBeNull();
    expect(screen.getByText(title)).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "host.series.age_gate.confirm_r18" })
    ).not.toBeNull();
    expect(
      screen.getByText("host.series.age_gate.r18_description")
    ).not.toBeNull();
    expect(
      screen.getByRole("link", { name: "Back to home" }).getAttribute("href")
    ).toBe("/");
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
      expect(screen.getByText(title)).not.toBeNull();
    });
    expect(screen.queryByText("Series body")).toBeNull();
  });

  it("Skips the confirmation for a reader whose birth date proves the rating", () => {
    renderGate("r18", "r18");

    expect(screen.getByText("Series body")).not.toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "host.series.age_gate.confirm_r18",
      })
    ).toBeNull();
  });

  it("Still asks a reader whose birth date falls short of the rating", () => {
    renderGate("r18", "r15");

    expect(screen.getByText(title)).not.toBeNull();
    expect(screen.queryByText("Series body")).toBeNull();
  });
});
