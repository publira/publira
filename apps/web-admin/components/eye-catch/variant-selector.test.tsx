// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { EyeCatchVariantItem } from "./types";
import { EyeCatchVariantSelector } from "./variant-selector";

vi.mock("#components/client-message", () => ({
  ClientMessage: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
  useClientMessages: () => bindMessages(sharedCatalog("en"), "en"),
}));

const variant = (
  variantType: string,
  width: number,
  height: number
): EyeCatchVariantItem => ({
  contentType: "image/jpeg",
  fileSizeBytes: 4096,
  height,
  label: `${variantType}_${width}w`,
  url: `/images/series/img/${variantType}/${width}`,
  variantType,
  width,
});

const renderSelector = (variants: EyeCatchVariantItem[]) =>
  render(
    <EyeCatchVariantSelector
      localPreviewUrl=""
      onImageClick={vi.fn()}
      onSelectVariantType={vi.fn()}
      selectedVariantType={null}
      variants={variants}
    />
  );

afterEach(cleanup);

it("names each ratio the way the console does rather than by its key", () => {
  renderSelector([variant("portrait", 1200, 1600), variant("og", 1200, 630)]);

  expect(screen.getByText("Portrait (3:4)")).toBeTruthy();
  expect(screen.getByAltText("Link preview (1200:630) image")).toBeTruthy();
  expect(screen.queryByText("portrait")).toBeNull();
  expect(screen.queryByText("og")).toBeNull();
});

it("names a ratio the console does not know yet without showing its key", () => {
  renderSelector([variant("panorama", 2400, 800)]);

  expect(screen.getByText("Other ratio")).toBeTruthy();
  expect(screen.queryByText("panorama")).toBeNull();
});
