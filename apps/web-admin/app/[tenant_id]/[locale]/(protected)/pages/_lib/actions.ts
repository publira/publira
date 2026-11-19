"use server";

import { getLocales } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { verifyAdminSession, withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import {
  isFormText,
  optionalTrimmedString,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import type { AdminMessageAccessor } from "#lib/messages";
import {
  createPage,
  createPageTranslation,
  createPageVersion,
  deletePage,
  deletePageTranslation,
  getPage,
  listPageTranslations,
  pageCacheTag,
  pagesCacheTag,
  publishPageVersion,
  rollbackPageVersion,
  unpublishPage,
  updatePage,
} from "#lib/page";
import { TENANT_LEGAL_PAGES_SECTION_ID } from "#lib/tenant-legal-pages-shared";
import { findTenantLocales } from "#lib/tenant-locales";

import {
  isPageSlugConfirmed,
  normalizePageSlugInput,
  pageEditPath,
} from "../page-types";
import type { PageDeleteActionState, PageFormState } from "../page-types";

const formBooleanSchema = z.preprocess((value) => {
  if (!isFormText(value)) {
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
    displayInFooter: formBooleanSchema,
    // What the edit screen loaded, so the save can tell which half changed.
    initialContentMarkdown: z
      .string()
      .optional()
      .transform((value) => value ?? ""),
    initialDisplayInFooter: formBooleanSchema,
    initialTitle: optionalTrimmedString(),
    pageId: optionalTrimmedString(),
    requireAgreement: formBooleanSchema,
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
  initialDisplayInFooter: { kind: "value", name: "initial_display_in_footer" },
  initialTitle: { kind: "value", name: "initial_title" },
  pageId: { kind: "value", name: "page_id" },
  requireAgreement: { kind: "value", name: "require_agreement" },
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

/**
 * Why a translation in `translationLocale` cannot be started, or `undefined`
 * when the site offers that language. The API stores a translation in any
 * language this build serves, so the console is what keeps a page from
 * gaining one in a language its readers are never shown. A set that cannot be
 * read refuses rather than guessing.
 */
const unofferedLocaleMessage = async (
  tenantId: string,
  translationLocale: Locale,
  t: AdminMessageAccessor
): Promise<string | undefined> => {
  const locales = await findTenantLocales(tenantId);

  if (!locales) {
    return t("admin.pages.validation.locales_unavailable");
  }

  return locales.supportedLocales.includes(translationLocale)
    ? undefined
    : t("admin.pages.validation.locale_not_offered");
};

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

  // The page starts in the default language, which the site always offers;
  // a form that names another one was not sent by the create screen.
  if (parsed.data.translationLocale) {
    const unoffered = await unofferedLocaleMessage(
      parsed.data.tenantId,
      parsed.data.translationLocale,
      t
    );

    if (unoffered) {
      return toFailure(unoffered);
    }
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
 * title lives on the translation, Show in footer on the page, and the body on a
 * version. The first two go out in one RPC and the body in another, so each half
 * is written only where the editor changed it and a failure names the half it
 * belongs to — the first can be written before the second fails. The title and
 * Show in footer are each sent only when they changed, so a save never puts back
 * a value someone else changed since this screen loaded.
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

  const titleChanged = parsed.data.title !== parsed.data.initialTitle;

  const footerChanged =
    parsed.data.displayInFooter !== undefined &&
    parsed.data.displayInFooter !== parsed.data.initialDisplayInFooter;

  const detailsChanged = titleChanged || footerChanged;

  const contentChanged =
    parsed.data.contentMarkdown !== parsed.data.initialContentMarkdown;

  if (detailsChanged) {
    const result = await withAdminSessionReauth(() =>
      updatePage(
        {
          displayInFooter: footerChanged
            ? parsed.data.displayInFooter
            : undefined,
          pageId: parsed.data.pageId,
          tenantId: parsed.data.tenantId,
          title: titleChanged ? parsed.data.title : undefined,
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

    // Also re-renders the screen with this Action's answer, so when the body
    // fails below, the hidden initial_* baseline already holds what was just
    // written and a retry does not send it again.
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

/**
 * Publishes a version. On the tenant's terms of service or privacy policy, a
 * tenant admin's form also says whether readers have to agree to it again
 * (`require_agreement`); every other form leaves the field out, which publishes
 * a correction.
 */
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
        requireAgreement: parsed.data.requireAgreement === true,
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

  const unoffered = await unofferedLocaleMessage(
    tenantId,
    translationLocale,
    t
  );

  if (unoffered) {
    return toFailure(unoffered);
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

const deletePageSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    pageId: requiredTrimmedString(
      t("admin.pages.validation.update_id_missing")
    ),
    slugConfirmation: z.string().catch(""),
    tenantId: requiredTrimmedString(t("admin.pages.validation.tenant_missing")),
  });
};

/**
 * The editor of a translation that is published, where its **Unpublish** is.
 * The refusal names no translation, so this one is read again; when that read
 * fails or finds none published any more, the page's default one is opened.
 */
const publishedTranslationPath = async (
  input: { pageId: string; tenantId: string },
  locale: Locale
): Promise<string> => {
  const translations = await listPageTranslations(input, locale);

  const published = translations.ok
    ? translations.translations.find(
        (translation) => translation.publishedVersionId
      )
    : undefined;

  return pageEditPath(input.pageId, published?.locale);
};

/**
 * Deletes the page once the slug typed into the dialog is the one it has, then
 * leaves for the page list. The list names the page in its toast from the
 * query string, since no page is left to read its title from.
 */
export const deletePageAction = async (
  _prevState: PageDeleteActionState,
  formData: FormData
): Promise<PageDeleteActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await deletePageSchema(locale);

  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      pageId: { kind: "value", name: "page_id" },
      slugConfirmation: { kind: "value", name: "slug_confirmation" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { pageId, slugConfirmation, tenantId } = parsed.data;
  await verifyAdminSession(tenantId);

  const [t, target] = await Promise.all([
    getMessagesFor(locale),
    getPage({ pageId, tenantId }, locale),
  ]);

  if (!target.ok) {
    return {
      message: target.notFound
        ? t("admin.pages.delete.not_found")
        : target.message,
      ok: false,
    };
  }

  if (!isPageSlugConfirmed(slugConfirmation, target.page.slug)) {
    return { message: t("admin.pages.delete.slug_mismatch"), ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    deletePage({ pageId, tenantId }, locale)
  );

  if (!result.ok) {
    if (!result.reference) {
      return { message: result.message, ok: false };
    }

    const href =
      result.reference === "unpublish"
        ? await publishedTranslationPath({ pageId, tenantId }, locale)
        : `/settings#${TENANT_LEGAL_PAGES_SECTION_ID}`;

    return {
      link: { href, reference: result.reference },
      message: result.message,
      ok: false,
    };
  }

  updateTag(pagesCacheTag(tenantId));
  updateTag(pageCacheTag(tenantId, pageId));

  redirect(
    `/pages?${new URLSearchParams({ deleted: "1", deleted_title: target.page.title }).toString()}`
  );
};
