// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AccountIcon } from "./account-icon";

const icon = { height: 512, url: "/images/users/U001/icon-1.png", width: 512 };

const fallback = <span data-testid="fallback" />;

afterEach(cleanup);

describe("AccountIcon", () => {
  it("draws the account's icon", () => {
    render(
      <AccountIcon alt="Your icon" fallback={fallback} icon={icon} size={80} />
    );

    expect(screen.getByAltText<HTMLImageElement>("Your icon").src).toContain(
      "icon-1.png"
    );
    expect(screen.queryByTestId("fallback")).toBeNull();
  });

  it("draws the stand-in for an account with no icon", () => {
    render(
      <AccountIcon alt="Your icon" fallback={fallback} icon={null} size={80} />
    );

    expect(screen.getByTestId("fallback")).toBeTruthy();
    expect(screen.queryByAltText("Your icon")).toBeNull();
  });

  it("draws the stand-in rather than a broken image when the icon is gone", () => {
    render(
      <AccountIcon alt="Your icon" fallback={fallback} icon={icon} size={80} />
    );

    fireEvent.error(screen.getByAltText("Your icon"));

    expect(screen.getByTestId("fallback")).toBeTruthy();
    expect(screen.queryByAltText("Your icon")).toBeNull();
  });

  it("draws a new icon again after the one before it failed", () => {
    const { rerender } = render(
      <AccountIcon alt="Your icon" fallback={fallback} icon={icon} size={80} />
    );
    fireEvent.error(screen.getByAltText("Your icon"));

    rerender(
      <AccountIcon
        alt="Your icon"
        fallback={fallback}
        icon={{ ...icon, url: "/images/users/U001/icon-2.png" }}
        size={80}
      />
    );

    expect(screen.getByAltText<HTMLImageElement>("Your icon").src).toContain(
      "icon-2.png"
    );
  });
});
