"use server";

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
  createPageVersion,
  publishPageVersion,
  rollbackPageVersion,
  unpublishPage,
  updatePage,
} from "#lib/page";

import { normalizePageSlugInput } from "../page-types";
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
    return toFailure(result.message);
  }

  updateTag(`pages-${parsed.data.tenantId}`);

  if (parsed.data.contentMarkdown.trim()) {
    const versionResult = await withAdminSessionReauth(() =>
      createPageVersion(
        {
          contentMarkdown: parsed.data.contentMarkdown,
          pageId: result.page.id,
          tenantId: parsed.data.tenantId,
        },
        locale
      )
    );

    if (!versionResult.ok) {
      return toFailure(versionResult.message);
    }

    updateTag(`page-${parsed.data.tenantId}-${result.page.id}`);
  }

  redirect(`/pages/${result.page.id}?created=1`);
};

/**
 * The edit screen's one save. The title lives on the page and the body lives on
 * a version, so each half is written only where the editor changed it and a
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

    updateTag(`pages-${parsed.data.tenantId}`);
    updateTag(`page-${parsed.data.tenantId}-${parsed.data.pageId}`);
  }

  if (contentChanged) {
    const result = await withAdminSessionReauth(() =>
      createPageVersion(
        {
          contentMarkdown: parsed.data.contentMarkdown,
          pageId: parsed.data.pageId,
          tenantId: parsed.data.tenantId,
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

    updateTag(`page-${parsed.data.tenantId}-${parsed.data.pageId}`);
  }

  redirect(`/pages/${parsed.data.pageId}?saved=1`);
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
        versionId: parsed.data.versionId,
      },
      locale
    )
  );

  if (!result.ok) {
    throw new Error(result.message);
  }

  updateTag(`pages-${parsed.data.tenantId}`);
  updateTag(`page-${parsed.data.tenantId}-${parsed.data.pageId}`);

  redirect(`/pages/${parsed.data.pageId}?published=1`);
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
      },
      locale
    )
  );

  if (!result.ok) {
    throw new Error(result.message);
  }

  updateTag(`pages-${parsed.data.tenantId}`);
  updateTag(`page-${parsed.data.tenantId}-${parsed.data.pageId}`);

  redirect(`/pages/${parsed.data.pageId}?unpublished=1`);
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
        versionId: parsed.data.versionId,
      },
      locale
    )
  );

  if (!result.ok) {
    throw new Error(result.message);
  }

  updateTag(`page-${parsed.data.tenantId}-${parsed.data.pageId}`);

  redirect(`/pages/${parsed.data.pageId}?rolled_back=1`);
};
