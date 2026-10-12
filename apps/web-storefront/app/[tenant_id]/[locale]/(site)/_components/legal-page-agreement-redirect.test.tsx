// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LegalPageAgreementRedirect } from "./legal-page-agreement-redirect";

const navigation = vi.hoisted(() => ({
  pathname: "/my",
  // Next.js's redirect() throws to stop the render; the test only records
  // where it would have sent the reader.
  redirect: vi.fn((_url: string) => null),
  search: "",
}));

vi.mock("next/navigation", () => ({
  redirect: navigation.redirect,
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

afterEach(() => {
  cleanup();
  navigation.pathname = "/my";
  navigation.search = "";
});

const AGREEMENT_PATH = "/settings/agreement";
const OWED = ["/pages/terms", "/settings"];

const gate = ({
  check = () => Promise.resolve(OWED),
  exemptPaths,
  mode = "visible",
}: {
  check?: () => Promise<string[] | null>;
  exemptPaths: string[] | null;
  mode?: "hidden" | "visible";
}) => (
  <Activity mode={mode}>
    <LegalPageAgreementRedirect
      agreementPath={AGREEMENT_PATH}
      check={check}
      exemptPaths={exemptPaths}
    />
  </Activity>
);

describe("LegalPageAgreementRedirect", () => {
  it("sends a reader who owes an agreement on from the page the server read", () => {
    render(gate({ exemptPaths: OWED }));

    expect(navigation.redirect).toHaveBeenCalledWith(
      "/settings/agreement?returnTo=%2Fmy"
    );
  });

  it("leaves a reader who owes an agreement on a page they are asked to read", () => {
    navigation.pathname = "/pages/terms";
    render(gate({ exemptPaths: OWED }));

    expect(navigation.redirect).not.toHaveBeenCalled();
  });

  it("does not act for a page its layout no longer shows", () => {
    const { rerender } = render(gate({ exemptPaths: OWED }));
    navigation.redirect.mockClear();

    // The reader is on the agreement screen, and Next.js keeps the layout of
    // the page they left rendered behind a hidden Activity.
    navigation.pathname = AGREEMENT_PATH;
    navigation.search = "returnTo=%2Fmy";
    act(() => {
      rerender(gate({ exemptPaths: OWED, mode: "hidden" }));
    });

    expect(navigation.redirect).not.toHaveBeenCalled();
  });

  it("asks the server about a page reached by a client-side navigation", async () => {
    const { promise, resolve } = Promise.withResolvers<string[] | null>();
    const check = vi.fn(() => promise);
    const { rerender } = render(gate({ check, exemptPaths: null }));

    navigation.pathname = "/labels";
    act(() => {
      rerender(gate({ check, exemptPaths: null }));
    });
    expect(check).toHaveBeenCalledTimes(1);
    expect(navigation.redirect).not.toHaveBeenCalled();

    await act(async () => {
      resolve(OWED);
      await promise;
    });
    expect(navigation.redirect).toHaveBeenCalledWith(
      "/settings/agreement?returnTo=%2Flabels"
    );
  });

  it("forgets an answer once its layout is hidden", async () => {
    const check = vi
      .fn<() => Promise<string[] | null>>()
      .mockResolvedValueOnce(OWED)
      .mockResolvedValueOnce(null);
    const { rerender } = render(gate({ check, exemptPaths: null }));
    navigation.pathname = "/labels";
    await act(async () => {
      rerender(gate({ check, exemptPaths: null }));
      await check.mock.results[0]?.value;
    });
    expect(navigation.redirect).toHaveBeenLastCalledWith(
      "/settings/agreement?returnTo=%2Flabels"
    );
    navigation.redirect.mockClear();

    // The reader agrees on the agreement screen and is returned to the page
    // they were asked from, whose layout the server renders again.
    navigation.pathname = AGREEMENT_PATH;
    navigation.search = "returnTo=%2Flabels";
    act(() => {
      rerender(gate({ check, exemptPaths: null, mode: "hidden" }));
    });
    navigation.pathname = "/labels";
    navigation.search = "";
    await act(async () => {
      rerender(gate({ check, exemptPaths: null }));
      await check.mock.results[1]?.value;
    });

    expect(navigation.redirect).not.toHaveBeenCalled();
  });

  it("asks again when its layout is shown again before the reader agreed", async () => {
    const check = vi.fn(() => Promise.resolve(OWED));
    const { rerender } = render(gate({ check, exemptPaths: null }));
    navigation.pathname = "/labels";
    await act(async () => {
      rerender(gate({ check, exemptPaths: null }));
      await check.mock.results[0]?.value;
    });
    navigation.redirect.mockClear();

    // The reader leaves the agreement screen with the browser's back button,
    // and Next.js shows the layout it kept without rendering it again.
    navigation.pathname = AGREEMENT_PATH;
    navigation.search = "returnTo=%2Flabels";
    act(() => {
      rerender(gate({ check, exemptPaths: null, mode: "hidden" }));
    });
    navigation.pathname = "/labels";
    navigation.search = "";
    await act(async () => {
      rerender(gate({ check, exemptPaths: null }));
      await check.mock.results[1]?.value;
    });

    expect(check).toHaveBeenCalledTimes(2);
    expect(navigation.redirect).toHaveBeenLastCalledWith(
      "/settings/agreement?returnTo=%2Flabels"
    );
  });
});
