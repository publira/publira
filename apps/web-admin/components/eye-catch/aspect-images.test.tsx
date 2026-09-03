// @vitest-environment jsdom

import { cleanup, render as renderBase, screen } from "@testing-library/react";
import React from "react";
import { afterEach, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import { EyeCatchAspectImages } from "./aspect-images";
import type { EyeCatchVariantItem } from "./types";

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const action = () => Promise.resolve(null);

const render = (ui: React.ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleProvider locale="ja">{children}</AdminLocaleProvider>
    ),
  });

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

afterEach(() => {
  cleanup();
});

it("shows a slot for every delivered ratio", () => {
  render(
    <EyeCatchAspectImages
      publicId="SERIES001"
      uploadAction={action}
      variants={[variant("portrait", 1200, 1600)]}
    />
  );

  for (const variantType of ["portrait", "square", "landscape", "og"]) {
    expect(screen.getByText(variantType)).toBeTruthy();
  }
});

it("shows the size of the image a ratio currently holds", () => {
  render(
    <EyeCatchAspectImages
      publicId="SERIES001"
      uploadAction={action}
      variants={[
        variant("portrait", 1200, 1600),
        variant("landscape", 1600, 900),
      ]}
    />
  );

  expect(screen.getByText("1200×1600")).toBeTruthy();
  expect(screen.getByText("1600×900")).toBeTruthy();
});

it("marks a ratio the eye-catch holds no image for", () => {
  render(
    <EyeCatchAspectImages
      publicId="SERIES001"
      uploadAction={action}
      variants={[variant("portrait", 1200, 1600)]}
    />
  );

  // portrait is filled, so the other three report an empty slot.
  expect(screen.getAllByText("画像がありません")).toHaveLength(3);
});

it("asks for a cover image before opening the ratio slots", () => {
  render(
    <EyeCatchAspectImages
      publicId="SERIES001"
      uploadAction={action}
      variants={[]}
    />
  );

  expect(screen.queryByText("portrait")).toBeNull();
  expect(
    screen.getByText(/先にアイキャッチ画像を登録してください/u)
  ).toBeTruthy();
});
