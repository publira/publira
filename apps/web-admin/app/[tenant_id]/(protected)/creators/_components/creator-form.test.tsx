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

import type { CreatorListItem } from "../creator-types";
import { CreatorForm } from "./creator-form";

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

const action = () => Promise.resolve(null);

const render = (ui: React.ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleProvider locale="en">{children}</AdminLocaleProvider>
    ),
  });

const creator: CreatorListItem = {
  iconImageFileSizeBytes: 0,
  iconImageUpdatedAt: "",
  iconImageUrl: "",
  name: "Existing Creator",
  profileText: "Creator profile",
  publicId: "CREATOR001",
};

/**
 * Next.js keeps recently visited pages mounted inside a hidden `<Activity>`
 * for its router bfcache, so the create form and the edit form are in the
 * document at the same time.
 */
const renderBothForms = () =>
  render(
    <>
      <CreatorForm action={action} mode="create" />
      <CreatorForm action={action} initialCreator={creator} mode="update" />
    </>
  );

afterEach(() => {
  cleanup();
});

it("keeps the ids unique when it is mounted twice", () => {
  renderBothForms();

  const ids = [...document.querySelectorAll("[id]")].map(
    (element) => element.id
  );

  expect(ids.length).toBeGreaterThan(0);
  expect(ids).toHaveLength(new Set(ids).size);
});

it("points each label at its own input when it is mounted twice", () => {
  renderBothForms();

  const names = screen.getAllByLabelText<HTMLInputElement>(/^Name/u);

  expect(names).toHaveLength(2);
  expect(names.map((input) => input.value)).toEqual(["", creator.name]);
});

/** Picks an icon file and reports its size the way a browser would. */
const pickIcon = (container: HTMLElement, width: number, height: number) => {
  const fileInput =
    container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!fileInput) {
    throw new Error("the form has no icon file input");
  }
  fireEvent.change(fileInput, {
    target: { files: [new File(["x"], "icon.jpg", { type: "image/jpeg" })] },
  });

  // jsdom decodes nothing, so the frame has no dimensions to derive itself
  // from until the image reports them.
  const framed = screen.getByAltText("The image being framed");
  Object.defineProperty(framed, "naturalWidth", { value: width });
  Object.defineProperty(framed, "naturalHeight", { value: height });
  fireEvent.load(framed);
};

it("frames a picked icon at the centre square the API would have cut", () => {
  const createObjectURL = vi.fn(() => "blob:picked-file");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

  const { container } = render(
    <CreatorForm action={action} initialCreator={creator} mode="update" />
  );

  // Nothing has been decoded yet, so the upload states no rectangle and the
  // API takes the cut from the centre as it always has.
  expect(container.querySelector('input[name="crop"]')).toBeNull();

  pickIcon(container, 600, 400);

  // The centre square of a 600x400 file, which is exactly what an upload
  // carrying no rectangle delivers.
  expect(
    container.querySelector<HTMLInputElement>('input[name="crop"]')?.value
  ).toBe("100,0,400,400");

  vi.unstubAllGlobals();
});

it("previews the framed square rather than the whole picked file", () => {
  const createObjectURL = vi.fn(() => "blob:picked-file");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

  const { container } = render(
    <CreatorForm action={action} initialCreator={creator} mode="update" />
  );

  pickIcon(container, 600, 400);

  const preview = container.querySelector<HTMLImageElement>(
    'img[alt="The selected image, framed as the icon will be cut"]'
  );
  // The file is 400 tall and the square keeps all of that height, so the
  // preview shows it at its own height, shifted left by the part beside it.
  expect(preview?.style.height).toBe("100%");
  expect(preview?.style.left).toBe(`${(-100 / 400) * 100}%`);

  vi.unstubAllGlobals();
});
