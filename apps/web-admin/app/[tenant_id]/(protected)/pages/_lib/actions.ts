"use server";

import { getLocales } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import {
  optionalTrimmedString,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import {
  createPage,
  createPageTranslation,
  createPageVersion,
  deletePageTranslation,
  pageCacheTag,
  pagesCacheTag,
  publishPageVersion,
  rollbackPageVersion,
  unpublishPage,
  updatePage,
} from "#lib/page";

import { normalizePageSlugInput, pageEditPath } from "../page-types";
import type { PageFormState } from "../page-types";

const displayInFooterSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return;
  }

  const raw = value.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}, z.boolean().optional());

const pageCommonSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    contentMarkdown: z
      .string()
      .optional()
      .transform((value) => value ?? ""),
    displayInFooter: displayInFooterSchema,
    // What the edit screen loaded, so the save can tell which half changed.
    initialContentMarkdown: z
      .string()
      .optional()
      .transform((value) => value ?? ""),
    initialTitle: optionalTrimmedString(),
    pageId: optionalTrimmedString(),
    slug: optionalTrimmedString(
      255,
      t("admin.pages.validation.slug_too_long")
    ).transform((value) => normalizePageSlugInput(value)),
    tenantId: requiredTrimmedString(t("admin.pages.validation.tenant_missing")),
    title: optionalTrimmedString(
      255,
      t("admin.pages.validation.title_too_long")
    ),
    // The translation a form edits. Blank only on the create form, whose page
    // has the one translation the server made with it.
    translationLocale: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z
        .enum(getLocales(), {
          error: t("admin.pages.validation.locale_invalid"),
        })
        .optional()
    ),
    versionId: optionalTrimmedString(),
  });
};
const pageFormFields = {
  contentMarkdown: { kind: "value", name: "content_markdown" },
  displayInFooter: { kind: "value", name: "display_in_footer" },
  initialContentMarkdown: { kind: "value", name: "initial_content_markdown" },
  initialTitle: { kind: "value", name: "initial_title" },
  pageId: { kind: "value", name: "page_id" },
  slug: "value",
  tenantId: { kind: "value", name: "tenant_id" },
  title: "value",
  translationLocale: { kind: "value", name: "translation_locale" },
  versionId: { kind: "value", name: "version_id" },
} as const;

const toFailure = (message: string): NonNullable<PageFormState> => ({
  message,
  ok: false,
});

const parsePageForm = async (formData: FormData, locale: Locale) => {
  const schema = await pageCommonSchema(locale);

  return schema.safeParse(toFormDataInput(formData, pageFormFields));
};

export const createPageAction = async (
  _prevState: PageFormState,
  formData: FormData
): Promise<PageFormState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, parsed] = await Promise.all([
    getMessagesFor(locale),
    parsePageForm(formData, locale),
  ]);
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error, { locale }));
  }
  if (!parsed.data.title) {
    return toFailure(t("admin.pages.validation.title_required"));
  }

  const result = await withAdminSessionReauth(() =>
    createPage(
      {
        displayInFooter: parsed.data.displayInFooter === true,
        slug: parsed.data.slug,
        tenantId: parsed.data.tenantId,
        title: parsed.data.title,
      },
      locale
    )
  );

  if (!result.ok) {
    return result.field === "slug"
      ? {
          fieldErrors: { slug: result.message },
          message: t("errors.validation"),
          ok: false,
        }
      : toFailure(result.message);
  }

  updateTag(pagesCacheTag(parsed.data.tenantId));

  if (parsed.data.contentMarkdown.trim()) {
    const versionResult = await withAdminSessionReauth(() =>
      createPageVersion(
        {
          contentMarkdown: parsed.data.contentMarkdown,
          pageId: result.page.id,
          tenantId: parsed.data.tenantId,
          translationLocale: result.page.locale,
        },
        locale
      )
    );

    if (!versionResult.ok) {
      return toFailure(versionResult.message);
    }

    updateTag(pageCacheTag(parsed.data.tenantId, result.page.id));
  }

  redirect(pageEditPath(result.page.id, result.page.locale, "created"));
};

/**
 * The edit screen's one save, within the translation the screen is showing. The
 * title lives on the translation and the body lives on a version, so each half is written only where the editor changed it and a
 * failure names the half it belongs to — the two are separate RPCs, and the
 * first can be written before the second fails.
 */
export const savePageAction = async (
  _prevState: PageFormState,
  formData: FormData
): Promise<PageFormState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, parsed] = await Promise.all([
    getMessagesFor(locale),
    parsePageForm(formData, locale),
  ]);
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error, { locale }));
  }
  if (!parsed.data.pageId) {
    return toFailure(t("admin.pages.validation.update_id_missing"));
  }
  if (!parsed.data.title) {
    return toFailure(t("admin.pages.validation.title_required"));
  }

  const detailsChanged = parsed.data.title !== parsed.data.initialTitle;
  const contentChanged =
    parsed.data.contentMarkdown !== parsed.data.initialContentMarkdown;

  if (detailsChanged) {
    const result = await withAdminSessionReauth(() =>
      updatePage(
        {
          displayInFooter: parsed.data.displayInFooter,
          pageId: parsed.data.pageId,
          tenantId: parsed.data.tenantId,
          title: parsed.data.title,
          translationLocale: parsed.data.translationLocale,
        },
        locale
      )
    );

    if (!result.ok) {
      return toFailure(
        t("admin.pages.workspace.save_failed_details", {
          message: result.message,
        })
      );
    }

    updateTag(pagesCacheTag(parsed.data.tenantId));
    updateTag(pageCacheTag(parsed.data.tenantId, parsed.data.pageId));
  }

  if (contentChanged) {
    const result = await withAdminSessionReauth(() =>
      createPageVersion(
        {
          contentMarkdown: parsed.data.contentMarkdown,
          pageId: parsed.data.pageId,
          tenantId: parsed.data.tenantId,
          translationLocale: parsed.data.translationLocale,
        },
        locale
      )
    );

    if (!result.ok) {
      return toFailure(
        detailsChanged
          ? t("admin.pages.workspace.save_failed_content_after_details", {
              message: result.message,
            })
          : t("admin.pages.workspace.save_failed_content", {
              message: result.message,
            })
      );
    }

    updateTag(pageCacheTag(parsed.data.tenantId, parsed.data.pageId));
  }

  redirect(
    pageEditPath(parsed.data.pageId, parsed.data.translationLocale, "saved")
  );
};

export const publishVersionAction = async (formData: FormData) => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const parsed = await parsePageForm(formData, locale);
  if (!parsed.success || !parsed.data.pageId || !parsed.data.versionId) {
    return;
  }

  const result = await withAdminSessionReauth(() =>
    publishPageVersion(
      {
        pageId: parsed.data.pageId,
        tenantId: parsed.data.tenantId,
        translationLocale: parsed.data.translationLocale,
        versionId: parsed.data.versionId,
      },
      locale
    )
  );

  if (!result.ok) {
    throw new Error(result.message);
  }

  updateTag(pagesCacheTag(parsed.data.tenantId));
  updateTag(pageCacheTag(parsed.data.tenantId, parsed.data.pageId));

  redirect(
    pageEditPath(parsed.data.pageId, parsed.data.translationLocale, "published")
  );
};

export const unpublishPageAction = async (formData: FormData) => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const parsed = await parsePageForm(formData, locale);
  if (!parsed.success || !parsed.data.pageId) {
    return;
  }

  const result = await withAdminSessionReauth(() =>
    unpublishPage(
      {
        pageId: parsed.data.pageId,
        tenantId: parsed.data.tenantId,
        translationLocale: parsed.data.translationLocale,
      },
      locale
    )
  );

  if (!result.ok) {
    throw new Error(result.message);
  }

  updateTag(pagesCacheTag(parsed.data.tenantId));
  updateTag(pageCacheTag(parsed.data.tenantId, parsed.data.pageId));

  redirect(
    pageEditPath(
      parsed.data.pageId,
      parsed.data.translationLocale,
      "unpublished"
    )
  );
};

export const rollbackVersionAction = async (formData: FormData) => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const parsed = await parsePageForm(formData, locale);
  if (!parsed.success || !parsed.data.pageId || !parsed.data.versionId) {
    return;
  }

  const result = await withAdminSessionReauth(() =>
    rollbackPageVersion(
      {
        pageId: parsed.data.pageId,
        tenantId: parsed.data.tenantId,
        translationLocale: parsed.data.translationLocale,
        versionId: parsed.data.versionId,
      },
      locale
    )
  );

  if (!result.ok) {
    throw new Error(result.message);
  }

  updateTag(pageCacheTag(parsed.data.tenantId, parsed.data.pageId));

  redirect(
    pageEditPath(
      parsed.data.pageId,
      parsed.data.translationLocale,
      "rolled_back"
    )
  );
};

/** Adds a translation of a page in a locale it has none in yet, titled as submitted. */
export const addPageTranslationAction = async (
  _prevState: PageFormState,
  formData: FormData
): Promise<PageFormState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, parsed] = await Promise.all([
    getMessagesFor(locale),
    parsePageForm(formData, locale),
  ]);
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error, { locale }));
  }
  const { pageId, tenantId, title, translationLocale } = parsed.data;
  if (!pageId) {
    return toFailure(t("admin.pages.validation.update_id_missing"));
  }
  if (!translationLocale) {
    return toFailure(t("admin.pages.validation.locale_invalid"));
  }
  if (!title) {
    return toFailure(t("admin.pages.validation.title_required"));
  }

  const result = await withAdminSessionReauth(() =>
    createPageTranslation(
      { pageId, tenantId, title, translationLocale },
      locale
    )
  );

  if (!result.ok) {
    return toFailure(result.message);
  }

  updateTag(pagesCacheTag(tenantId));
  updateTag(pageCacheTag(tenantId, pageId));

  redirect(pageEditPath(pageId, translationLocale, "translation_added"));
};

/**
 * Deletes the translation the screen is showing, with its versions, and returns
 * to the page's default one. The server refuses to delete a page's last
 * translation, and that refusal is what the form reports.
 */
export const deletePageTranslationAction = async (
  _prevState: PageFormState,
  formData: FormData
): Promise<PageFormState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, parsed] = await Promise.all([
    getMessagesFor(locale),
    parsePageForm(formData, locale),
  ]);
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error, { locale }));
  }
  const { pageId, tenantId, translationLocale } = parsed.data;
  if (!pageId) {
    return toFailure(t("admin.pages.validation.update_id_missing"));
  }
  if (!translationLocale) {
    return toFailure(t("admin.pages.validation.locale_invalid"));
  }

  const result = await withAdminSessionReauth(() =>
    deletePageTranslation({ pageId, tenantId, translationLocale }, locale)
  );

  if (!result.ok) {
    return toFailure(result.message);
  }

  updateTag(pagesCacheTag(tenantId));
  updateTag(pageCacheTag(tenantId, pageId));

  redirect(pageEditPath(pageId, undefined, "translation_deleted"));
};
