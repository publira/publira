import { createHash } from "node:crypto";

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  createGenreViaUi,
  createLabelViaUi,
  createSeriesViaUi,
  genreRow,
  signInAsSeedAdmin,
} from "../src/admin";
import {
  deleteGenresByNames,
  deleteLabelsByPublicIds,
  deleteSeriesByPublicIds,
} from "../src/db";
import {
  publishedAtOneHourAgo,
  uniqueSuffix,
} from "../src/scenarios/admin-publish";
import type { EyeCatchAspect } from "../src/scenarios/eye-catch";
import {
  EYE_CATCH_ASPECT_FIXTURES,
  EYE_CATCH_ASPECTS,
  EYE_CATCH_SOURCE_FIXTURE,
  EYE_CATCH_UNDERSIZED_ASPECT,
  EYE_CATCH_UNDERSIZED_FIXTURE,
} from "../src/scenarios/eye-catch";
import { hostPath, WEB_ADMIN_BASE_URL, WEB_HOST_BASE_URL } from "../src/urls";

const adminUrl = (pathname: string): string =>
  `${WEB_ADMIN_BASE_URL}${pathname}`;

/** A page of the seed tenant's public site. */
const hostUrl = (pathname: string): string => `${WEB_HOST_BASE_URL}${pathname}`;

/** The delivery path each ratio's slot currently shows. */
type AspectSources = Record<EyeCatchAspect, string>;

/** sha256 of the pixels each ratio's slot is showing. */
type AspectDigests = Record<EyeCatchAspect, string>;

/**
 * One delivered size: the image route, the ratio, the width, and that row's
 * version. `next/image` appends the loader's `w` and `fit` after the version.
 */
const eyeCatchDeliveryURL = (entityPath: string, aspect: string): RegExp =>
  new RegExp(
    String.raw`^/images/${entityPath}/[^/]+/${aspect}/\d+\?v=[0-9a-f-]{36}(?:&w=\d+&fit=[\w-]+)?$`,
    "u"
  );

/**
 * The card for one ratio. The slot's picker button carries the ratio in its
 * label, and the card is its parent — which is also where that slot's upload
 * form and result message live, so four slots sharing one Action stay apart.
 */
const aspectSlot = (page: Page, aspect: EyeCatchAspect): Locator =>
  page
    .getByRole("button", { name: `Select an image for ${aspect}` })
    .locator("xpath=..");

const expectMessage = (scope: Page | Locator, text: string): Promise<void> =>
  expect(scope.getByRole("status").filter({ hasText: text })).toBeVisible({
    // Uploading a whole eye-catch crops and encodes twelve images.
    timeout: 60_000,
  });

/** Upload one image as the whole eye-catch, filling every ratio at once. */
const uploadEyeCatchSource = async (page: Page): Promise<void> => {
  await page
    .locator('input[name="eye_catch_image"]')
    .setInputFiles(EYE_CATCH_SOURCE_FIXTURE);
  await page.getByRole("button", { name: "Update cover image" }).click();
  await expectMessage(page, "Cover image updated.");
};

/**
 * Where the editor leaves the crop frame before submitting. `centred` is where
 * the dialog opens it, which is the cut the API takes on its own.
 */
type CropFraming = "centred" | "off-centre";

/**
 * Upload one image for a single ratio, leaving the other three alone.
 *
 * Choosing a file opens the crop dialog, so framing is part of choosing and
 * the dialog has to be closed before the slot's own button is reachable again.
 * The frame is moved by its keyboard step rather than by dragging: a press
 * lands the same way on every runner, and it is the accessible path through
 * the control besides.
 */
const uploadAspectImage = async (
  page: Page,
  aspect: EyeCatchAspect,
  fixture: string,
  framing: CropFraming = "centred"
): Promise<void> => {
  const slot = aspectSlot(page, aspect);
  await slot.locator('input[name="aspect_image"]').setInputFiles(fixture);
  if (framing === "off-centre") {
    await page
      .getByRole("button", { name: "Move the crop frame" })
      .press("Shift+ArrowUp");
  }
  await page.getByRole("button", { name: "Done" }).click();
  await slot.getByRole("button", { name: "Replace" }).click();
};

/**
 * The delivery path each ratio's preview points at.
 *
 * A ratio holding no image renders a placeholder instead of an `<img>`, so
 * reading a `src` for all four is also what says every ratio was filled.
 */
const aspectSources = async (page: Page): Promise<AspectSources> => {
  const previews = EYE_CATCH_ASPECTS.map((aspect) =>
    aspectSlot(page, aspect).getByRole("img")
  );
  await Promise.all(
    previews.map((preview) => expect(preview).toBeVisible({ timeout: 60_000 }))
  );
  const srcs = await Promise.all(
    previews.map((preview) => preview.getAttribute("src"))
  );

  const sources: Partial<AspectSources> = {};
  for (const [index, aspect] of EYE_CATCH_ASPECTS.entries()) {
    const src = srcs[index];
    if (!src) {
      throw new Error(`the ${aspect} preview has no src`);
    }
    sources[aspect] = src;
  }
  return sources as AspectSources;
};

/**
 * sha256 of the pixels an `<img>` is showing.
 *
 * `decode` waits for the current `src`, so a slot whose URL just changed is
 * hashed after the browser has fetched that URL. A fetch from outside the
 * page would miss the HTTP cache the element itself uses. The hash is taken
 * here rather than in the page: the console is served on `admin.localhost`,
 * which is not a secure context, so `crypto.subtle` is not there.
 */
const displayedDigest = async (image: Locator): Promise<string> => {
  const encoded = await image.evaluate(async (element: HTMLImageElement) => {
    await element.decode();
    if (element.naturalWidth === 0) {
      throw new Error("the image did not decode");
    }
    // A full-size copy of every ratio is enough to crash the page. A small
    // draw still changes when the picture does and stays put when it does not.
    const longest = Math.max(element.naturalWidth, element.naturalHeight);
    const scale = Math.min(1, 64 / longest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(element.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(element.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("the image did not decode");
    }
    context.drawImage(element, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  });
  return createHash("sha256").update(encoded).digest("hex");
};

/** The image each ratio's slot is showing. The four slots are read together. */
const displayedEyeCatch = async (page: Page): Promise<AspectDigests> => {
  const entries = await Promise.all(
    EYE_CATCH_ASPECTS.map(async (aspect) => {
      const image = aspectSlot(page, aspect).getByRole("img");
      await expect(image).toBeVisible();
      return [aspect, await displayedDigest(image)] as const;
    })
  );
  return Object.fromEntries(entries) as AspectDigests;
};

const expectAspectPaths = (
  sources: AspectSources,
  entityPath: string
): void => {
  for (const aspect of EYE_CATCH_ASPECTS) {
    expect(sources[aspect], aspect).toMatch(
      eyeCatchDeliveryURL(entityPath, aspect)
    );
  }
};

/** A replacement changes that ratio's URL and leaves the other three alone. */
const expectOnlyTheReplacedURLChanged = (
  before: AspectSources,
  after: AspectSources,
  replaced: EyeCatchAspect
): void => {
  expect(after[replaced], replaced).not.toBe(before[replaced]);
  for (const aspect of EYE_CATCH_ASPECTS) {
    if (aspect !== replaced) {
      expect(after[aspect], `${aspect} after replacing ${replaced}`).toBe(
        before[aspect]
      );
    }
  }
};

const expectOtherAspectsUnchanged = (
  before: AspectDigests,
  after: AspectDigests,
  replaced: EyeCatchAspect
): void => {
  for (const aspect of EYE_CATCH_ASPECTS) {
    if (aspect !== replaced) {
      expect(after[aspect], `${aspect} after replacing ${replaced}`).toBe(
        before[aspect]
      );
    }
  }
};

/** The aspect card stands in for the ratios until an eye-catch exists. */
const expectNoEyeCatchYet = (page: Page): Promise<void> =>
  expect(
    page.getByText(
      "Register a cover image first. Individual ratios can be replaced once the cover image exists."
    )
  ).toBeVisible();

/**
 * Replace each ratio in turn, checking after every upload that only that
 * ratio's delivered image moved.
 *
 * Recursion rather than a loop: each step compares against what the step
 * before it left, so the uploads cannot be started together.
 */
const replaceEachAspectInTurn = async (
  page: Page,
  delivered: AspectDigests,
  remaining: readonly EyeCatchAspect[]
): Promise<void> => {
  const [aspect, ...rest] = remaining;
  if (!aspect) {
    return;
  }

  const before = await aspectSources(page);
  await uploadAspectImage(page, aspect, EYE_CATCH_ASPECT_FIXTURES[aspect]);
  await expectMessage(
    aspectSlot(page, aspect),
    "The image for this ratio was replaced."
  );

  const after = await aspectSources(page);
  expectOnlyTheReplacedURLChanged(before, after, aspect);
  const next = await displayedEyeCatch(page);
  expect(next[aspect], aspect).not.toBe(delivered[aspect]);
  expectOtherAspectsUnchanged(delivered, next, aspect);

  await replaceEachAspectInTurn(page, next, rest);
};

/**
 * The console's eye-catch upload, from the file picker through the admin API
 * and image processing to the image the page shows.
 *
 * `server/internal/imageproc`, the admin API handlers, and the console
 * component each have their own tests; what only this suite can see is that
 * the three agree on one image. The ratios are independent — nothing records
 * where an image was derived from, and no ratio falls back to another — so
 * "the other three did not move" is the pixels on screen and the URL each
 * slot names, rather than whether a slot is present.
 *
 * Each test creates the series, label, or genre it uploads to and drops it in
 * `afterEach`, so a run against a long-lived stack leaves nothing behind.
 */
test.describe("admin eye-catch upload", () => {
  let createdSeriesIds: string[] = [];
  let createdLabelIds: string[] = [];
  /** Genres are addressed by name: the console never shows their public id. */
  let createdGenreNames: string[] = [];

  test.beforeEach(async ({ page }) => {
    createdSeriesIds = [];
    createdLabelIds = [];
    createdGenreNames = [];
    await signInAsSeedAdmin(page);
  });

  test.afterEach(() => {
    deleteSeriesByPublicIds(createdSeriesIds);
    deleteLabelsByPublicIds(createdLabelIds);
    deleteGenresByNames(createdGenreNames);
    createdSeriesIds = [];
    createdLabelIds = [];
    createdGenreNames = [];
  });

  /** A published series on its eye-catch tab, with no image yet. */
  const openSeriesEyeCatchTab = async (
    page: Page
  ): Promise<{ publicId: string; title: string }> => {
    const suffix = uniqueSuffix();
    const title = `E2E Eye-catch Series ${suffix}`;
    const publicId = await createSeriesViaUi(page, {
      publishedAt: publishedAtOneHourAgo(),
      synopsis: `Cover image check ${suffix}`,
      title,
    });
    createdSeriesIds.push(publicId);
    await page.goto(adminUrl(`/series/${publicId}?tab=eye-catch`));
    return { publicId, title };
  };

  const openLabelEyeCatchTab = async (page: Page): Promise<string> => {
    const publicId = await createLabelViaUi(
      page,
      `E2E Eye-catch Label ${uniqueSuffix()}`
    );
    createdLabelIds.push(publicId);
    await page.goto(adminUrl(`/labels/${publicId}?tab=eye-catch`));
    return publicId;
  };

  test("one upload fills every delivered ratio of a series", async ({
    page,
  }) => {
    await openSeriesEyeCatchTab(page);
    // No eye-catch yet: the ratios are not offered at all.
    await expectNoEyeCatchYet(page);

    await uploadEyeCatchSource(page);

    const sources = await aspectSources(page);
    expectAspectPaths(sources, "series");
    const digests = await displayedEyeCatch(page);
    // Four crops of one source, so four different images — a ratio serving
    // another ratio's bytes would have passed everything above.
    expect(new Set(Object.values(digests)).size).toBe(EYE_CATCH_ASPECTS.length);
  });

  test("replacing one ratio leaves the other three exactly as they were", async ({
    page,
  }) => {
    await openSeriesEyeCatchTab(page);
    await uploadEyeCatchSource(page);

    const delivered = await displayedEyeCatch(page);
    await replaceEachAspectInTurn(page, delivered, EYE_CATCH_ASPECTS);
  });

  test("a source below the ratio's minimum is refused and changes nothing", async ({
    page,
  }) => {
    await openSeriesEyeCatchTab(page);
    await uploadEyeCatchSource(page);

    const beforeSources = await aspectSources(page);
    const before = await displayedEyeCatch(page);

    await uploadAspectImage(
      page,
      EYE_CATCH_UNDERSIZED_ASPECT,
      EYE_CATCH_UNDERSIZED_FIXTURE
    );
    // The refusal names the minimum of the ratio it was refused for, not the
    // 2400x3200px a whole eye-catch asks for.
    await expectMessage(
      aspectSlot(page, EYE_CATCH_UNDERSIZED_ASPECT),
      "For this ratio, choose a JPEG, PNG, or WebP image no larger than 10MB and at least 1200x1600px"
    );

    expect(await aspectSources(page)).toEqual(beforeSources);
    expect(await displayedEyeCatch(page)).toEqual(before);
  });

  test("a frame nobody touched cuts where the cover image already did", async ({
    page,
  }) => {
    await openSeriesEyeCatchTab(page);
    await uploadEyeCatchSource(page);

    const beforeSources = await aspectSources(page);
    const before = await displayedEyeCatch(page);

    // The very file the cover image was cut from, offered again through one
    // ratio's own slot with the frame left where the dialog opened it. The
    // cover image took that ratio out of the centre of this file, so the slot
    // has to hand those same bytes back.
    await uploadAspectImage(page, "landscape", EYE_CATCH_SOURCE_FIXTURE);
    await expectMessage(
      aspectSlot(page, "landscape"),
      "The image for this ratio was replaced."
    );

    const afterSources = await aspectSources(page);
    expectOnlyTheReplacedURLChanged(beforeSources, afterSources, "landscape");
    const after = await displayedEyeCatch(page);
    expect(after.landscape).toBe(before.landscape);
    expectOtherAspectsUnchanged(before, after, "landscape");
  });

  test("the frame decides which part of the upload survives", async ({
    page,
  }) => {
    await openSeriesEyeCatchTab(page);
    await uploadEyeCatchSource(page);

    const beforeSources = await aspectSources(page);
    const centred = await displayedEyeCatch(page);

    await uploadAspectImage(
      page,
      "landscape",
      EYE_CATCH_SOURCE_FIXTURE,
      "off-centre"
    );
    await expectMessage(
      aspectSlot(page, "landscape"),
      "The image for this ratio was replaced."
    );

    // Same file, same ratio, same sizes: only the rectangle the editor framed
    // separates these bytes from the ones above.
    const afterSources = await aspectSources(page);
    expectOnlyTheReplacedURLChanged(beforeSources, afterSources, "landscape");
    const framed = await displayedEyeCatch(page);
    expect(framed.landscape).not.toBe(centred.landscape);
    expectOtherAspectsUnchanged(centred, framed, "landscape");
  });

  test("the uploaded eye-catch reaches the series on web-host", async ({
    page,
  }) => {
    const { publicId, title } = await openSeriesEyeCatchTab(page);
    await uploadEyeCatchSource(page);

    // First host request for this public_id, so nothing was cached back when
    // the series had no eye-catch.
    const response = await page.goto(hostUrl(hostPath(`/series/${publicId}`)));
    expect(response?.status(), await page.content()).toBe(200);

    const cover = page.getByRole("img", { name: title });
    await expect(cover).toHaveAttribute(
      "src",
      eyeCatchDeliveryURL("series", "portrait")
    );
    // The browser fetched it and got an image back, not a 404 page.
    await expect
      .poll(() =>
        cover.evaluate((image: HTMLImageElement) => image.naturalWidth)
      )
      .toBeGreaterThan(0);
  });

  /**
   * The browser keeps a public image for an hour. Replacing a ratio has to
   * hand the page a URL it has not fetched, on the console and on the
   * storefront, or the slot keeps painting the image it replaced.
   */
  test("replacing one ratio shows the new image on the console and the storefront", async ({
    page,
  }) => {
    const { publicId, title } = await openSeriesEyeCatchTab(page);
    await uploadEyeCatchSource(page);

    const beforeSources = await aspectSources(page);
    const beforeShown = await displayedEyeCatch(page);

    await page.goto(hostUrl(hostPath(`/series/${publicId}`)));
    const cover = page.getByRole("img", { name: title });
    await expect(cover).toHaveAttribute("src", beforeSources.portrait);
    const storefrontBefore = await displayedDigest(cover);

    await page.goto(adminUrl(`/series/${publicId}?tab=eye-catch`));
    await uploadAspectImage(
      page,
      "portrait",
      EYE_CATCH_ASPECT_FIXTURES.portrait
    );
    await expectMessage(
      aspectSlot(page, "portrait"),
      "The image for this ratio was replaced."
    );

    const afterSources = await aspectSources(page);
    expectOnlyTheReplacedURLChanged(beforeSources, afterSources, "portrait");
    const afterShown = await displayedEyeCatch(page);
    expect(afterShown.portrait).not.toBe(beforeShown.portrait);
    expectOtherAspectsUnchanged(beforeShown, afterShown, "portrait");

    // A navigation, so an image URL the browser already fetched may be served
    // from its cache. The storefront's cache tags are dropped out of band, so
    // the new URL is polled for rather than read once.
    await expect(async () => {
      await page.goto(hostUrl(hostPath(`/series/${publicId}`)));
      await expect(cover).toHaveAttribute("src", afterSources.portrait, {
        timeout: 5000,
      });
    }).toPass({ timeout: 60_000 });
    expect(await displayedDigest(cover)).not.toBe(storefrontBefore);
  });

  test("a label's eye-catch fills every ratio and replaces one at a time", async ({
    page,
  }) => {
    await openLabelEyeCatchTab(page);
    await expectNoEyeCatchYet(page);

    await uploadEyeCatchSource(page);

    const sources = await aspectSources(page);
    expectAspectPaths(sources, "labels");

    const before = await displayedEyeCatch(page);
    expect(new Set(Object.values(before)).size).toBe(EYE_CATCH_ASPECTS.length);

    await uploadAspectImage(
      page,
      "landscape",
      EYE_CATCH_ASPECT_FIXTURES.landscape
    );
    await expectMessage(
      aspectSlot(page, "landscape"),
      "The image for this ratio was replaced."
    );

    const afterSources = await aspectSources(page);
    expectOnlyTheReplacedURLChanged(sources, afterSources, "landscape");
    const after = await displayedEyeCatch(page);
    expect(after.landscape).not.toBe(before.landscape);
    expectOtherAspectsUnchanged(before, after, "landscape");
  });

  /**
   * A genre has no page of its own until it is opened from its row in the
   * list, which is also where the result has to show: the list is the one
   * screen every genre is seen on.
   */
  test("a genre's eye-catch is uploaded, replaced one ratio at a time, and cleared from its row", async ({
    page,
  }) => {
    const name = `E2E Eye-catch Genre ${uniqueSuffix()}`;
    createdGenreNames.push(name);
    await createGenreViaUi(page, name);

    const thumbnail = genreRow(page, name).getByRole("img", {
      name: `Cover image of ${name}`,
    });
    const openEyeCatchTab = async (): Promise<void> => {
      await genreRow(page, name).getByRole("link", { name: "Edit" }).click();
      await page.getByRole("link", { name: "Cover image" }).click();
    };

    await expect(thumbnail).toHaveCount(0);
    await openEyeCatchTab();
    await expectNoEyeCatchYet(page);

    await uploadEyeCatchSource(page);

    const sources = await aspectSources(page);
    expectAspectPaths(sources, "genres");

    const before = await displayedEyeCatch(page);
    expect(new Set(Object.values(before)).size).toBe(EYE_CATCH_ASPECTS.length);

    await uploadAspectImage(
      page,
      "landscape",
      EYE_CATCH_ASPECT_FIXTURES.landscape
    );
    await expectMessage(
      aspectSlot(page, "landscape"),
      "The image for this ratio was replaced."
    );

    const afterSources = await aspectSources(page);
    expectOnlyTheReplacedURLChanged(sources, afterSources, "landscape");
    const after = await displayedEyeCatch(page);
    expect(after.landscape).not.toBe(before.landscape);
    expectOtherAspectsUnchanged(before, after, "landscape");

    await page.getByRole("link", { name: "Back to list" }).click();
    await expect(thumbnail).toHaveAttribute(
      "src",
      eyeCatchDeliveryURL("genres", "square")
    );

    await openEyeCatchTab();
    await page
      .getByRole("button", { name: "Delete the current eye-catch image" })
      .click();
    await page.getByRole("button", { name: "Update cover image" }).click();
    await expectMessage(page, "Cover image updated.");
    await expectNoEyeCatchYet(page);

    await page.getByRole("link", { name: "Back to list" }).click();
    await expect(genreRow(page, name)).toBeVisible();
    await expect(thumbnail).toHaveCount(0);
  });

  /**
   * The storefront draws a genre's eye-catch in place of the covers its tile
   * would otherwise show, and in the header of the genre's own page. The admin
   * API drops the storefront's cache tags out of band from the response the
   * console has already rendered, so each public read is a poll rather than a
   * single request after a fixed wait.
   */
  test("a genre's eye-catch reaches the storefront's genre list and genre page, and clearing it takes it back off", async ({
    page,
  }) => {
    const name = `E2E Storefront Genre ${uniqueSuffix()}`;
    createdGenreNames.push(name);
    await createGenreViaUi(page, name);

    // The storefront addresses a genre by the public id the console keeps in
    // the row's Edit link rather than on screen.
    const editHref = await genreRow(page, name)
      .getByRole("link", { name: "Edit" })
      .getAttribute("href");
    const genreId = editHref?.split("/").at(-1) ?? "";
    expect(genreId).not.toBe("");
    const openEyeCatchTab = async (): Promise<void> => {
      await page.goto(adminUrl("/genres"));
      await genreRow(page, name).getByRole("link", { name: "Edit" }).click();
      await page.getByRole("link", { name: "Cover image" }).click();
    };

    await openEyeCatchTab();
    await uploadEyeCatchSource(page);

    // The genre carries no series, so without its eye-catch the tile is one
    // flat frame, and any image in it is the one the console uploaded.
    const tileImages = page
      .getByRole("link", { name })
      .locator('img[src^="/images/"]');
    await expect(async () => {
      await page.goto(hostUrl(hostPath("/genres")));
      await expect(tileImages).toHaveAttribute(
        "src",
        eyeCatchDeliveryURL("genres", "portrait"),
        { timeout: 5000 }
      );
    }).toPass({ timeout: 60_000 });

    await page.goto(hostUrl(hostPath(`/genres/${genreId}`)));
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(
      page.getByRole("main").locator('img[src^="/images/genres/"]')
    ).toHaveAttribute("src", eyeCatchDeliveryURL("genres", "landscape"));

    await openEyeCatchTab();
    await page
      .getByRole("button", { name: "Delete the current eye-catch image" })
      .click();
    await page.getByRole("button", { name: "Update cover image" }).click();
    await expectMessage(page, "Cover image updated.");

    await expect(async () => {
      await page.goto(hostUrl(hostPath("/genres")));
      await expect(page.getByRole("link", { name })).toBeVisible({
        timeout: 5000,
      });
      await expect(tileImages).toHaveCount(0, { timeout: 5000 });
    }).toPass({ timeout: 60_000 });
  });
});
