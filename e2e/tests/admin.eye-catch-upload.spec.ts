import { createHash } from "node:crypto";

import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  createLabelViaUi,
  createSeriesViaUi,
  signInAsSeedAdmin,
} from "../src/admin";
import { deleteLabelsByPublicIds, deleteSeriesByPublicIds } from "../src/db";
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
import {
  hostPath,
  WEB_ADMIN_BASE_URL,
  WEB_HOST_EDGE_BASE_URL,
} from "../src/urls";

const adminUrl = (pathname: string): string =>
  `${WEB_ADMIN_BASE_URL}${pathname}`;

/**
 * A delivered eye-catch is `/images/{series,labels}/{id}/{ratio}/{width}` on
 * the reader's origin, and only the Traefik edge joins web-host and
 * image-server under one host and port. The console is a different origin, so
 * the previews there name the path and the bytes are read from the edge.
 */
const edgeUrl = (pathname: string): string =>
  `${WEB_HOST_EDGE_BASE_URL}${pathname}`;

/** The delivery path each ratio's slot currently shows. */
type AspectSources = Record<EyeCatchAspect, string>;

/** sha256 of the image each of those paths delivers. */
type AspectDigests = Record<EyeCatchAspect, string>;

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

/**
 * Upload one image as the whole eye-catch, filling every ratio at once.
 *
 * The confirmation differs by entity: a series has an Action of its own for
 * this form and says so, while a label's eye-catch form submits the same
 * Action as its name form and gets that Action's wording back.
 */
const uploadEyeCatchSource = async (
  page: Page,
  fileInputId: string,
  confirmation: string
): Promise<void> => {
  await page.locator(`#${fileInputId}`).setInputFiles(EYE_CATCH_SOURCE_FIXTURE);
  await page.getByRole("button", { name: "Update cover image" }).click();
  await expectMessage(page, confirmation);
};

/** Upload one image for a single ratio, leaving the other three alone. */
const uploadAspectImage = async (
  page: Page,
  aspect: EyeCatchAspect,
  fixture: string
): Promise<void> => {
  const slot = aspectSlot(page, aspect);
  await slot.locator('input[name="aspect_image"]').setInputFiles(fixture);
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

const aspectDigests = async (
  request: APIRequestContext,
  sources: AspectSources
): Promise<AspectDigests> => {
  const responses = await Promise.all(
    EYE_CATCH_ASPECTS.map((aspect) => request.get(edgeUrl(sources[aspect])))
  );
  const bodies = await Promise.all(
    responses.map((response) => response.body())
  );

  const digests: Partial<AspectDigests> = {};
  for (const [index, aspect] of EYE_CATCH_ASPECTS.entries()) {
    const response = responses[index];
    expect(response.status(), `${aspect}: ${sources[aspect]}`).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/^image\//u);
    digests[aspect] = createHash("sha256").update(bodies[index]).digest("hex");
  }
  return digests as AspectDigests;
};

/** What every ratio delivers right now, through the paths the console shows. */
const deliveredEyeCatch = async (
  page: Page,
  request: APIRequestContext
): Promise<AspectDigests> => {
  const sources = await aspectSources(page);
  return await aspectDigests(request, sources);
};

const expectAspectPaths = (
  sources: AspectSources,
  entityPath: string
): void => {
  for (const aspect of EYE_CATCH_ASPECTS) {
    expect(sources[aspect], aspect).toMatch(
      new RegExp(String.raw`^/images/${entityPath}/[^/]+/${aspect}/\d+$`, "u")
    );
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
  request: APIRequestContext,
  delivered: AspectDigests,
  remaining: readonly EyeCatchAspect[]
): Promise<void> => {
  const [aspect, ...rest] = remaining;
  if (!aspect) {
    return;
  }

  await uploadAspectImage(page, aspect, EYE_CATCH_ASPECT_FIXTURES[aspect]);
  await expectMessage(
    aspectSlot(page, aspect),
    "The image for this ratio was replaced."
  );

  const next = await deliveredEyeCatch(page, request);
  expect(next[aspect], aspect).not.toBe(delivered[aspect]);
  expectOtherAspectsUnchanged(delivered, next, aspect);

  await replaceEachAspectInTurn(page, request, next, rest);
};

/**
 * The console's eye-catch upload, from the file picker through the admin API
 * and image processing to the bytes the reader's origin serves.
 *
 * `server/internal/imageproc`, the admin API handlers, and the console
 * component each have their own tests; what only this suite can see is that
 * the three agree on one image. The ratios are independent — nothing records
 * where an image was derived from, and no ratio falls back to another — so
 * "the other three did not move" is compared byte for byte rather than by
 * presence.
 *
 * Each test creates the series or label it uploads to and drops it in
 * `afterEach`, so a run against a long-lived stack leaves nothing behind.
 */
test.describe("admin eye-catch upload", () => {
  let createdSeriesIds: string[] = [];
  let createdLabelIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    createdSeriesIds = [];
    createdLabelIds = [];
    await signInAsSeedAdmin(page);
  });

  test.afterEach(() => {
    deleteSeriesByPublicIds(createdSeriesIds);
    deleteLabelsByPublicIds(createdLabelIds);
    createdSeriesIds = [];
    createdLabelIds = [];
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
    request,
  }) => {
    await openSeriesEyeCatchTab(page);
    // No eye-catch yet: the ratios are not offered at all.
    await expectNoEyeCatchYet(page);

    await uploadEyeCatchSource(
      page,
      "series_eye_catch_image",
      "Cover image updated."
    );

    const sources = await aspectSources(page);
    expectAspectPaths(sources, "series");

    const digests = await aspectDigests(request, sources);
    // Four crops of one source, so four different images — a ratio serving
    // another ratio's bytes would have passed everything above.
    expect(new Set(Object.values(digests)).size).toBe(EYE_CATCH_ASPECTS.length);
  });

  test("replacing one ratio leaves the other three exactly as they were", async ({
    page,
    request,
  }) => {
    await openSeriesEyeCatchTab(page);
    await uploadEyeCatchSource(
      page,
      "series_eye_catch_image",
      "Cover image updated."
    );

    const delivered = await deliveredEyeCatch(page, request);
    await replaceEachAspectInTurn(page, request, delivered, EYE_CATCH_ASPECTS);
  });

  test("a source below the ratio's minimum is refused and changes nothing", async ({
    page,
    request,
  }) => {
    await openSeriesEyeCatchTab(page);
    await uploadEyeCatchSource(
      page,
      "series_eye_catch_image",
      "Cover image updated."
    );

    const before = await deliveredEyeCatch(page, request);

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

    expect(await deliveredEyeCatch(page, request)).toEqual(before);
  });

  test("the uploaded eye-catch reaches the series on web-host", async ({
    page,
  }) => {
    const { publicId, title } = await openSeriesEyeCatchTab(page);
    await uploadEyeCatchSource(
      page,
      "series_eye_catch_image",
      "Cover image updated."
    );

    // First host request for this public_id, so nothing was cached back when
    // the series had no eye-catch. The edge, not web-host's own port:
    // `/images` resolves to image-server only there.
    const response = await page.goto(edgeUrl(hostPath(`/series/${publicId}`)));
    expect(response?.status(), await page.content()).toBe(200);

    const cover = page.getByRole("img", { name: title });
    await expect(cover).toHaveAttribute(
      "src",
      /^\/images\/series\/[^/]+\/portrait\/\d+$/u
    );
    // The browser fetched it and got an image back, not a 404 page.
    await expect
      .poll(() =>
        cover.evaluate((image: HTMLImageElement) => image.naturalWidth)
      )
      .toBeGreaterThan(0);
  });

  test("a label's eye-catch fills every ratio and replaces one at a time", async ({
    page,
    request,
  }) => {
    await openLabelEyeCatchTab(page);
    await expectNoEyeCatchYet(page);

    await uploadEyeCatchSource(page, "label_eye_catch_image", "Label updated.");

    const sources = await aspectSources(page);
    expectAspectPaths(sources, "labels");

    const before = await aspectDigests(request, sources);
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

    const after = await deliveredEyeCatch(page, request);
    expect(after.landscape).not.toBe(before.landscape);
    expectOtherAspectsUnchanged(before, after, "landscape");
  });
});
