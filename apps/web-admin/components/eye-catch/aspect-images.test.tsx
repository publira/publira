// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  act,
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import { EyeCatchAspectImages } from "./aspect-images";
import type { EyeCatchEntity } from "./aspect-messages";
import type { EyeCatchAspectActionState, EyeCatchVariantItem } from "./types";

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

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

const action = () => Promise.resolve(null);

const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
    ),
  });

const renderImages = ({
  entity = "series",
  id = "series-1",
  uploadAction = action,
  variants,
}: {
  entity?: EyeCatchEntity;
  id?: string;
  uploadAction?: (
    prevState: EyeCatchAspectActionState,
    formData: FormData
  ) => Promise<EyeCatchAspectActionState>;
  variants: EyeCatchVariantItem[];
}) =>
  render(
    <EyeCatchAspectImages
      entity={entity}
      id={id}
      tenantId="TENANT001"
      uploadAction={uploadAction}
      variants={variants}
    />
  );

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

/** One ratio's form. */
const slotForm = (container: HTMLElement, variantType: string) => {
  const form = container
    .querySelector(`input[name="variant_type"][value="${variantType}"]`)
    ?.closest("form");
  if (!form) {
    throw new Error(`the ${variantType} slot has no form`);
  }
  return form;
};

/** Picks a file in one ratio's slot and returns that slot's form. */
const pickImage = (
  container: HTMLElement,
  variantType: string
): HTMLFormElement => {
  const form = slotForm(container, variantType);
  const fileInput = form.querySelector<HTMLInputElement>('input[type="file"]');
  if (!fileInput) {
    throw new Error(`the ${variantType} slot has no file input`);
  }
  fireEvent.change(fileInput, {
    target: {
      files: [new File(["x"], `${variantType}.jpg`, { type: "image/jpeg" })],
    },
  });
  return form;
};

/**
 * Reports the picked file's size the way a browser would. jsdom decodes
 * nothing, so the frame has no dimensions to derive itself from until this
 * runs. Only the slot a file was picked in renders a frame, so the one image
 * being framed is that slot's.
 */
const decodePickedImage = (width: number, height: number) => {
  const framed = screen.getByAltText("The image being framed");
  Object.defineProperty(framed, "naturalWidth", { value: width });
  Object.defineProperty(framed, "naturalHeight", { value: height });
  fireEvent.load(framed);
};

/** Stubs the object URLs jsdom lacks, which the slot creates and revokes. */
const stubObjectUrls = () => {
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:picked-file"),
    revokeObjectURL: vi.fn(),
  });
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows a slot for every delivered ratio", () => {
  renderImages({ variants: [variant("portrait", 1200, 1600)] });

  for (const name of [
    "Portrait (3:4)",
    "Square (1:1)",
    "Landscape (16:9)",
    "Link preview (1200:630)",
  ]) {
    expect(screen.getByText(name)).toBeTruthy();
  }
});

it("says where the site and the app use each ratio of a series", () => {
  renderImages({ variants: [variant("portrait", 1200, 1600)] });

  expect(
    screen.getByText(
      "The cover on shelves on the site and in the app, and on the series' page on the site."
    )
  ).toBeTruthy();
  expect(
    screen.getByText("One of the images the site offers search engines.")
  ).toBeTruthy();
});

// A label's portrait image is drawn nowhere, which is worth knowing before
// framing one; a line written for a series would claim otherwise.
it("says where each ratio of a label is used, not where a series' is", () => {
  renderImages({
    entity: "label",
    id: "label-1",
    variants: [variant("portrait", 1200, 1600)],
  });

  expect(screen.getByText("The label's tile in the app.")).toBeTruthy();
  expect(
    screen.getAllByText("Not shown on the site or in the app yet.")
  ).toHaveLength(2);
  expect(screen.queryByText(/series' page/u)).toBeNull();
});

// The ratio keys are what the RPCs take, and a staff member reading or
// hearing one learns nothing about the image it stands for.
it("neither shows nor reads out a ratio by its key", () => {
  const { container } = renderImages({
    variants: [
      variant("portrait", 1200, 1600),
      variant("square", 1200, 1200),
      variant("landscape", 1600, 900),
      variant("og", 1200, 630),
    ],
  });

  const keys = /\b(?:portrait|square|landscape|og)\b/u;
  const accessibleNames = [
    ...screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label")),
    ...screen.getAllByRole("img").map((image) => image.getAttribute("alt")),
  ];

  expect(container.textContent).not.toMatch(keys);
  expect(accessibleNames.filter((name) => keys.test(name ?? ""))).toEqual([]);
});

it("shows the size of the image a ratio currently holds", () => {
  renderImages({
    variants: [
      variant("portrait", 1200, 1600),
      variant("landscape", 1600, 900),
    ],
  });

  expect(screen.getByText("1200×1600")).toBeTruthy();
  expect(screen.getByText("1600×900")).toBeTruthy();
});

it("marks a ratio the eye-catch holds no image for", () => {
  renderImages({ variants: [variant("portrait", 1200, 1600)] });

  // portrait is filled, so the other three report an empty slot.
  expect(screen.getAllByText("No image yet")).toHaveLength(3);
});

it("asks for a cover image before opening the ratio slots", () => {
  renderImages({ variants: [] });

  expect(screen.queryByText("Portrait (3:4)")).toBeNull();
  expect(screen.getByText(/Register a cover image first/u)).toBeTruthy();
});

it("shows what is stored once the upload is on its way", async () => {
  stubObjectUrls();
  const upload = Promise.withResolvers<EyeCatchAspectActionState>();
  const { container } = renderImages({
    uploadAction: () => upload.promise,
    variants: [variant("landscape", 1600, 900)],
  });

  const stored = "/images/series/img/landscape/1600";
  const image = () =>
    container
      .querySelector<HTMLImageElement>('img[alt="Landscape (16:9) image"]')
      ?.getAttribute("src");

  expect(image()).toBe(stored);

  const form = pickImage(container, "landscape");
  expect(image()).toBe("blob:picked-file");

  // The stored crop is the truth once the upload is on its way; a preview left
  // set would keep the uncropped file on screen, because the page redraws the
  // screen without remounting this slot.
  fireEvent.submit(form);
  await waitFor(() => {
    expect(image()).toBe(stored);
  });

  await act(async () => {
    upload.resolve({ message: "Could not upload.", ok: false });
    await upload.promise;
  });

  // A refused upload leaves the stored image showing too, since nothing
  // replaced it.
  expect(await screen.findByText("Could not upload.")).toBeTruthy();
  expect(image()).toBe(stored);
  expect(
    within(form).getByRole<HTMLButtonElement>("button", { name: "Replace" })
      .disabled
  ).toBe(true);
});

it("posts the record's ID under the field its upload action reads", () => {
  const { container } = renderImages({
    entity: "label",
    id: "label-1",
    variants: [variant("landscape", 1600, 900)],
  });

  const formData = new FormData(slotForm(container, "landscape"));
  expect(formData.get("label_id")).toBe("label-1");
  expect(formData.get("tenant_id")).toBe("TENANT001");
});

it("frames the picked file where the API would have cut it anyway", () => {
  stubObjectUrls();
  const { container } = renderImages({
    variants: [variant("landscape", 1600, 900)],
  });

  const form = pickImage(container, "landscape");
  expect(
    screen.getByRole("heading", { name: "Frame the Landscape (16:9) image" })
  ).toBeTruthy();
  // Nothing has been decoded yet, so the upload states no rectangle and the
  // API takes the cut from the centre as it always has.
  expect(form.querySelector('input[name="crop"]')).toBeNull();

  decodePickedImage(2400, 3200);

  // The centre of a 2400x3200 file at 16:9, which is exactly what an upload
  // carrying no rectangle delivers.
  expect(
    form.querySelector<HTMLInputElement>('input[name="crop"]')?.value
  ).toBe("0,925,2400,1350");
});

it("previews the framed region rather than the whole picked file", () => {
  stubObjectUrls();
  const { container } = renderImages({
    variants: [variant("landscape", 1600, 900)],
  });

  pickImage(container, "landscape");
  decodePickedImage(2400, 3200);

  const preview = container.querySelector<HTMLImageElement>(
    'img[alt="Landscape (16:9) image"]'
  );
  // The file is 2400 wide and the frame keeps all of that width, so the slot
  // shows it at its own width, shifted up by the part above the frame.
  expect(preview?.style.width).toBe("100%");
  expect(preview?.style.top).toBe(`${(-925 / 1350) * 100}%`);
});

// The Action carries the file picked when the slot was submitted, so a file
// picked while it is in flight would show in the slot without being uploaded.
// A control its `<fieldset>` closes keeps `disabled` false and matches
// `:disabled` instead.
it("closes the slot's picker while its upload is in flight", async () => {
  const { container } = renderImages({
    // Never resolved: the assertions are about the window the upload is open in.
    uploadAction: () => Promise.withResolvers<never>().promise,
    variants: [variant("landscape", 1600, 900)],
  });

  const form = slotForm(container, "landscape");
  const fileInput = form.querySelector<HTMLInputElement>('input[type="file"]');
  if (!fileInput) {
    throw new Error("the landscape slot has no file input");
  }
  const picker = screen.getByRole<HTMLButtonElement>("button", {
    name: "Select an image for Landscape (16:9)",
  });

  expect(picker.matches(":disabled")).toBe(false);
  expect(fileInput.matches(":disabled")).toBe(false);

  fireEvent.submit(form);

  await waitFor(() => {
    expect(picker.matches(":disabled")).toBe(true);
    expect(fileInput.matches(":disabled")).toBe(true);
  });
});
