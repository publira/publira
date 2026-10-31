// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SignInPanelImage } from "./sign-in-panel-image";

const variant = {
  contentType: "image/jpeg",
  fileSizeBytes: 204_800,
  height: 1600,
  label: "original",
  url: "/images/tenants/sign-in-1/sign_in",
  variantType: "sign_in",
  width: 1200,
};

afterEach(cleanup);

describe("SignInPanelImage", () => {
  it("draws the tenant's image as decoration", () => {
    const { container } = render(<SignInPanelImage variant={variant} />);

    const image = container.querySelector("img");
    expect(image?.getAttribute("alt")).toBe("");
    expect(image?.src).toContain("sign-in-1");
  });

  it("gives way to the tenant's colours when the image fails to load", () => {
    const { container } = render(<SignInPanelImage variant={variant} />);

    const image = container.querySelector("img");

    if (!image) {
      throw new Error("the image was not rendered");
    }

    fireEvent.error(image);

    expect(container.querySelector("img")).toBeNull();
    expect(
      container.querySelector('[aria-hidden="true"].sign-in-panel-ground')
    ).not.toBeNull();
  });
});
