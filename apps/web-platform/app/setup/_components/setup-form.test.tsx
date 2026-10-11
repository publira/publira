// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SetupForm } from "./setup-form";

const { mockGetPlatformCurrencyForSetup } = vi.hoisted(() => ({
  mockGetPlatformCurrencyForSetup: vi.fn(),
}));

vi.mock("#lib/initial-locale", () => ({
  getInitialLocaleCandidate: () => Promise.resolve("en"),
}));

vi.mock("#lib/platform-settings", () => ({
  getPlatformCurrencyForSetup: mockGetPlatformCurrencyForSetup,
}));

vi.mock("../_lib/actions", () => ({ setupAction: vi.fn() }));

vi.mock("./setup-message", () => ({
  SetupMessage: ({ message }: { message: string }) => message,
}));

const currencyInput = () =>
  screen.getByRole<HTMLInputElement>("combobox", {
    name: /platform\.auth\.setup\.default_currency_label/u,
  });

const postedCurrency = (container: HTMLElement) =>
  container.querySelector<HTMLInputElement>('input[name="default_currency"]');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("SetupForm currency", () => {
  it("starts on the currency publiractl setup saved", async () => {
    mockGetPlatformCurrencyForSetup.mockResolvedValue({
      defaultCurrency: "JPY",
      defaultCurrencyLocked: false,
      state: "saved",
    });

    const { container } = render(await SetupForm());

    expect(currencyInput().value).toBe("Japanese Yen (JPY)");
    expect(currencyInput().disabled).toBe(false);
    expect(postedCurrency(container)?.value).toBe("JPY");
    expect(
      screen.getByText("platform.auth.setup.default_currency_help")
    ).toBeDefined();
  });

  it("shows a locked currency read-only with the reason, and posts none", async () => {
    mockGetPlatformCurrencyForSetup.mockResolvedValue({
      defaultCurrency: "JPY",
      defaultCurrencyLocked: true,
      state: "saved",
    });

    const { container } = render(await SetupForm());

    expect(currencyInput().value).toBe("Japanese Yen (JPY)");
    expect(currencyInput().disabled).toBe(true);
    expect(postedCurrency(container)).toBeNull();
    expect(
      screen.getByText("platform.auth.setup.default_currency_locked")
    ).toBeDefined();
  });

  it("waits for a choice when the platform has saved no settings", async () => {
    mockGetPlatformCurrencyForSetup.mockResolvedValue({ state: "none" });

    const { container } = render(await SetupForm());

    expect(currencyInput().value).toBe("");
    expect(currencyInput().disabled).toBe(false);
    expect(postedCurrency(container)?.value).toBe("");
  });

  it("keeps a currency it could not read, and says so beside the field", async () => {
    mockGetPlatformCurrencyForSetup.mockResolvedValue({ state: "failed" });

    const { container } = render(await SetupForm());

    expect(currencyInput().disabled).toBe(true);
    expect(postedCurrency(container)).toBeNull();
    expect(
      screen.getByText("platform.auth.setup.default_currency_load_failed")
    ).toBeDefined();
  });
});
