// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ReaderIcon } from "./reader-icon";

const icon = { height: 512, url: "/images/users/U001/icon-1.png", width: 512 };

afterEach(cleanup);

describe("ReaderIcon", () => {
  it("draws the account's icon", () => {
    render(<ReaderIcon alt="Reader One's icon" icon={icon} size={64} />);

    expect(
      screen.getByAltText<HTMLImageElement>("Reader One's icon").src
    ).toContain("icon-1.png");
  });

  it("draws the outline, unannounced, for an account with no icon", () => {
    const { container } = render(
      <ReaderIcon alt="Reader One's icon" icon={null} size={64} />
    );

    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector("[aria-hidden='true'] svg")).toBeTruthy();
  });

  it("draws the outline rather than a broken image once the icon is gone", () => {
    const { container } = render(
      <ReaderIcon alt="Reader One's icon" icon={icon} size={64} />
    );

    fireEvent.error(screen.getByAltText("Reader One's icon"));

    expect(screen.queryByAltText("Reader One's icon")).toBeNull();
    expect(container.querySelector("[aria-hidden='true'] svg")).toBeTruthy();
  });

  it("draws a new icon again after the one before it failed", () => {
    const { rerender } = render(
      <ReaderIcon alt="Reader One's icon" icon={icon} size={64} />
    );

    fireEvent.error(screen.getByAltText("Reader One's icon"));

    rerender(
      <ReaderIcon
        alt="Reader One's icon"
        icon={{ ...icon, url: "/images/users/U001/icon-2.png" }}
        size={64}
      />
    );

    expect(
      screen.getByAltText<HTMLImageElement>("Reader One's icon").src
    ).toContain("icon-2.png");
  });
});
