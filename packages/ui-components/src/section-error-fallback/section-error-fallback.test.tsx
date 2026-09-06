// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SectionError,
  SectionErrorActions,
  SectionErrorHeading,
  SectionErrorTitle,
} from "../section-error/section-error";
import {
  SectionErrorDigest,
  sectionErrorFallback,
  SectionErrorRetry,
} from "./section-error-fallback";

const body = (
  <SectionError>
    <SectionErrorHeading>
      <SectionErrorTitle>Could not load the operator list</SectionErrorTitle>
    </SectionErrorHeading>
    <SectionErrorActions>
      <SectionErrorRetry>Try again</SectionErrorRetry>
    </SectionErrorActions>
    <SectionErrorDigest>Error ID:</SectionErrorDigest>
  </SectionError>
);

const withDigest = (digest: string) =>
  Object.assign(new Error("Boom"), { digest });

afterEach(cleanup);

describe("sectionErrorFallback", () => {
  it("shows the digest the caught error carries, behind the caller's prefix", () => {
    render(
      sectionErrorFallback(
        { fallback: body },
        { error: withDigest("2870412426"), retry: vi.fn() }
      )
    );

    expect(screen.getByText("2870412426")).toBeTruthy();
    expect(screen.getByText(/Error ID:/u)).toBeTruthy();
  });

  it("leaves the digest line out when the error carries none", () => {
    render(
      sectionErrorFallback(
        { fallback: body },
        { error: new Error("Boom"), retry: vi.fn() }
      )
    );

    expect(screen.queryByText(/Error ID:/u)).toBeNull();
  });

  it("the retry control re-runs the subtree the boundary wraps", () => {
    const retry = vi.fn();
    render(
      sectionErrorFallback(
        { fallback: body },
        { error: new Error("Boom"), retry }
      )
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(retry).toHaveBeenCalledTimes(1);
  });
});
