// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import * as AuthScreen from ".";

afterEach(cleanup);

describe("AuthScreen", () => {
  it("composes the heading and the form into one main landmark", () => {
    render(
      <AuthScreen.Root>
        <AuthScreen.Main>
          <AuthScreen.Header>
            <AuthScreen.Title>Aoto Press</AuthScreen.Title>
          </AuthScreen.Header>
          <AuthScreen.Body>Sign in</AuthScreen.Body>
        </AuthScreen.Main>
      </AuthScreen.Root>
    );

    expect(screen.getByRole("heading", { name: "Aoto Press" })).toBeTruthy();
    expect(screen.getByRole("main").textContent).toContain("Sign in");
  });

  it("leaves the form the whole screen when no panel is supplied", () => {
    const { container } = render(
      <AuthScreen.Root>
        <AuthScreen.Main>
          <AuthScreen.Body>Sign in</AuthScreen.Body>
        </AuthScreen.Main>
      </AuthScreen.Root>
    );

    // The public site's screens keep the single centred column they had until
    // a tenant has an image to put beside the form.
    expect(container.firstElementChild?.children).toHaveLength(1);
  });
});

describe("AuthScreen.Pattern", () => {
  it("puts nothing in the accessibility tree", () => {
    const { container } = render(
      <AuthScreen.Root>
        <AuthScreen.Main>
          <AuthScreen.Header>
            <AuthScreen.Title>Publira</AuthScreen.Title>
          </AuthScreen.Header>
        </AuthScreen.Main>
        <AuthScreen.Panel>
          <AuthScreen.Pattern />
        </AuthScreen.Panel>
      </AuthScreen.Root>
    );

    expect(container.firstElementChild?.children).toHaveLength(2);
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
    expect(screen.getByRole("main").textContent).toBe("Publira");
  });
});
