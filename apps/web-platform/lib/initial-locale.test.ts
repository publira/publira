import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockHeaders } = vi.hoisted(() => ({ mockHeaders: vi.fn() }));

vi.mock("next/headers", () => ({ headers: mockHeaders }));

const importInitialLocale = () => import("./initial-locale");

const setAcceptLanguage = (value?: string) => {
  mockHeaders.mockResolvedValue(
    new Headers(value === undefined ? {} : { "accept-language": value })
  );
};

describe("getInitialLocaleCandidate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    setAcceptLanguage();
  });

  it("opens on the highest-weighted supported locale the header asks for", async () => {
    setAcceptLanguage("fr-FR,en-US;q=0.9,ja;q=0.8");
    const { getInitialLocaleCandidate } = await importInitialLocale();

    await expect(getInitialLocaleCandidate()).resolves.toBe("en");
  });

  it("opens on en when the request carries no Accept-Language", async () => {
    const { getInitialLocaleCandidate } = await importInitialLocale();

    await expect(getInitialLocaleCandidate()).resolves.toBe("en");
  });

  it("opens on en when the header names nothing this repository supports", async () => {
    setAcceptLanguage("fr-FR,de;q=0.9");
    const { getInitialLocaleCandidate } = await importInitialLocale();

    await expect(getInitialLocaleCandidate()).resolves.toBe("en");
  });
});
