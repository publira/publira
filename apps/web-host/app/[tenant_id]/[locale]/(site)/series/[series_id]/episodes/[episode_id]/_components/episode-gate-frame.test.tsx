// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { EpisodeImageItem } from "#lib/catalog";

import { EpisodeGateFrame } from "./episode-gate-frame";

afterEach(cleanup);

const previewImage = (id: string, displayOrder: number): EpisodeImageItem => ({
  contentType: "image/webp",
  displayOrder,
  fileSizeBytes: 0,
  height: 320,
  id,
  imageUrl: `/images/episodes/${id}/preview`,
  width: 226,
});

const previewImages = [previewImage("page_1", 1), previewImage("page_2", 2)];

describe("EpisodeGateFrame", () => {
  it("Draws the gate's card over the preview", () => {
    render(
      <EpisodeGateFrame previewImages={previewImages} readingDirection="ltr">
        <button type="button">Buy this episode</button>
      </EpisodeGateFrame>
    );

    expect(
      screen.getByRole("button", { name: "Buy this episode" })
    ).toBeDefined();
  });

  it("Draws each served rendition as it comes, and nothing else", () => {
    const { container } = render(
      <EpisodeGateFrame previewImages={previewImages} readingDirection="ltr">
        card
      </EpisodeGateFrame>
    );

    const images = [...container.querySelectorAll("img")];
    expect(images.map((image) => image.getAttribute("src"))).toEqual([
      "/images/episodes/page_1/preview",
      "/images/episodes/page_2/preview",
    ]);
    for (const image of images) {
      expect(image.getAttribute("width")).toBe("226");
      expect(image.getAttribute("height")).toBe("320");
    }
  });

  it("Keeps the preview away from assistive technology", () => {
    const { container } = render(
      <EpisodeGateFrame previewImages={previewImages} readingDirection="ltr">
        card
      </EpisodeGateFrame>
    );

    expect(screen.queryAllByRole("img")).toHaveLength(0);
    for (const image of container.querySelectorAll("img")) {
      expect(image.getAttribute("alt")).toBe("");
      expect(image.closest("[aria-hidden='true']")).not.toBeNull();
    }
  });

  it("Lays the opening pages out as a spread in the work's reading direction", () => {
    const { container, rerender } = render(
      <EpisodeGateFrame previewImages={previewImages} readingDirection="rtl">
        card
      </EpisodeGateFrame>
    );

    const spread = () => container.querySelector("img")?.parentElement;
    expect(spread()?.classList.contains("flex-row-reverse")).toBe(true);

    rerender(
      <EpisodeGateFrame previewImages={previewImages} readingDirection="ltr">
        card
      </EpisodeGateFrame>
    );
    expect(spread()?.classList.contains("flex-row-reverse")).toBe(false);
  });

  it("Shows the first page alone on a phone", () => {
    const { container } = render(
      <EpisodeGateFrame previewImages={previewImages} readingDirection="ltr">
        card
      </EpisodeGateFrame>
    );

    const [first, second] = container.querySelectorAll("img");
    expect(first?.classList.contains("max-sm:hidden")).toBe(false);
    expect(second?.classList.contains("max-sm:hidden")).toBe(true);
  });

  it("Still draws the card when the server sent no preview", () => {
    const { container } = render(
      <EpisodeGateFrame previewImages={[]} readingDirection="ltr">
        <button type="button">Sign in to read</button>
      </EpisodeGateFrame>
    );

    expect(container.querySelector("img")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Sign in to read" })
    ).toBeDefined();
  });
});
