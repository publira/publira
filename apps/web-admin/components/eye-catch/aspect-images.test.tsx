// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
} from "@testing-library/react";
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
      <AdminLocaleProvider locale="en">{children}</AdminLocaleProvider>
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
  expect(screen.getAllByText("No image yet")).toHaveLength(3);
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
  expect(screen.getByText(/Register a cover image first/u)).toBeTruthy();
});

it("stops showing the picked file once the form is submitted", () => {
  // jsdom has no object URLs, and the component revokes whatever it created,
  // so both halves are stubbed.
  const createObjectURL = vi.fn(() => "blob:picked-file");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

  const { container } = render(
    <EyeCatchAspectImages
      publicId="SERIES001"
      uploadAction={action}
      variants={[variant("landscape", 1600, 900)]}
    />
  );

  const stored = "/images/series/img/landscape/1600";
  const image = () =>
    container.querySelector<HTMLImageElement>(
      'img[alt="Generated image landscape"]'
    );

  expect(image()?.getAttribute("src")).toBe(stored);

  // The img sits in the slot's own <button>, so its closest div is that slot.
  const fileInput = image()
    ?.closest("div")
    ?.querySelector<HTMLInputElement>('input[type="file"]');
  if (!fileInput) {
    throw new Error("the landscape slot has no file input");
  }
  fireEvent.change(fileInput, {
    target: {
      files: [new File(["x"], "landscape.jpg", { type: "image/jpeg" })],
    },
  });
  expect(image()?.getAttribute("src")).toBe("blob:picked-file");

  const form = fileInput.closest("form");
  if (!form) {
    throw new Error("the file input is not inside a form");
  }
  fireEvent.submit(form);

  // The stored crop is the truth once the upload is on its way; a preview left
  // set would keep the uncropped file on screen, because the Action re-renders
  // the screen without remounting this slot.
  expect(image()?.getAttribute("src")).toBe(stored);

  vi.unstubAllGlobals();
});
