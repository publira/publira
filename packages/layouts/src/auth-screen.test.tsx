// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  AuthScreen,
  AuthScreenBody,
  AuthScreenHeader,
  AuthScreenMain,
  AuthScreenPanel,
  AuthScreenPattern,
  AuthScreenTitle,
} from "./auth-screen";

afterEach(cleanup);

describe("AuthScreen", () => {
  it("composes the heading and the form into one main landmark", () => {
    render(
      <AuthScreen>
        <AuthScreenMain>
          <AuthScreenHeader>
            <AuthScreenTitle>Aoto Press</AuthScreenTitle>
          </AuthScreenHeader>
          <AuthScreenBody>Sign in</AuthScreenBody>
        </AuthScreenMain>
      </AuthScreen>
    );

    expect(screen.getByRole("heading", { name: "Aoto Press" })).toBeTruthy();
    expect(screen.getByRole("main").textContent).toContain("Sign in");
  });

  it("leaves the form the whole screen when no panel is supplied", () => {
    const { container } = render(
      <AuthScreen>
        <AuthScreenMain>
          <AuthScreenBody>Sign in</AuthScreenBody>
        </AuthScreenMain>
      </AuthScreen>
    );

    // The public site's screens keep the single centred column they had until
    // a tenant has an image to put beside the form.
    expect(container.firstElementChild?.children).toHaveLength(1);
  });
});

describe("AuthScreenPattern", () => {
  it("puts nothing in the accessibility tree", () => {
    const { container } = render(
      <AuthScreen>
        <AuthScreenMain>
          <AuthScreenHeader>
            <AuthScreenTitle>Publira</AuthScreenTitle>
          </AuthScreenHeader>
        </AuthScreenMain>
        <AuthScreenPanel>
          <AuthScreenPattern />
        </AuthScreenPanel>
      </AuthScreen>
    );

    expect(container.firstElementChild?.children).toHaveLength(2);
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
    expect(screen.getByRole("main").textContent).toBe("Publira");
  });
});
