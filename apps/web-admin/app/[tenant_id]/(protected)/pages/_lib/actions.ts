"use server";

import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import {
  optionalTrimmedString,
  requiredTrimmedString,
} from "#lib/form-schemas";
import {
  createPage,
  createPageVersion,
  publishPageVersion,
  rollbackPageVersion,
  updatePage,
} from "#lib/page";

import { normalizePageSlugInput } from "../page-types";
import type { PageFormState, PageMutationMode } from "../page-types";

const displayInFooterSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return;
  }

  const raw = value.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}, z.boolean().optional());

const pageCommonSchema = z.object({
  contentMarkdown: z
    .string()
    .optional()
    .transform((value) => value ?? ""),
  displayInFooter: displayInFooterSchema,
  pageId: optionalTrimmedString(),
  slug: optionalTrimmedString(
    255,
    "slug は255文字以内で入力してください。"
  ).transform((value) => normalizePageSlugInput(value)),
  tenantId: requiredTrimmedString("テナント ID が見つかりません。"),
  title: optionalTrimmedString(
    255,
    "タイトルは255文字以内で入力してください。"
  ),
  versionId: optionalTrimmedString(),
});

const pageFormFields = {
  contentMarkdown: { kind: "value", name: "content_markdown" },
  displayInFooter: { kind: "value", name: "display_in_footer" },
  pageId: { kind: "value", name: "page_id" },
  slug: "value",
  tenantId: { kind: "value", name: "tenant_id" },
  title: "value",
  versionId: { kind: "value", name: "version_id" },
} as const;

const toFailure = (
  message: string,
  mode: PageMutationMode
): NonNullable<PageFormState> => ({
  message,
  mode,
  ok: false,
});

const parsePageForm = (formData: FormData) =>
  pageCommonSchema.safeParse(toFormDataInput(formData, pageFormFields));

export const createPageAction = async (
  _prevState: PageFormState,
  formData: FormData
): Promise<PageFormState> => {
  await assertSameOrigin();
  const parsed = parsePageForm(formData);
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error), "create");
  }
  if (!parsed.data.title) {
    return toFailure("タイトルは必須です。", "create");
  }

  const result = await withAdminSessionReauth(() =>
    createPage({
      displayInFooter: parsed.data.displayInFooter === true,
      slug: parsed.data.slug,
      tenantId: parsed.data.tenantId,
      title: parsed.data.title,
    })
  );

  if (!result.ok) {
    return toFailure(result.message, "create");
  }

  updateTag(`pages-${parsed.data.tenantId}`);

  if (parsed.data.contentMarkdown.trim()) {
    const versionResult = await withAdminSessionReauth(() =>
      createPageVersion({
        contentMarkdown: parsed.data.contentMarkdown,
        pageId: result.page.id,
        tenantId: parsed.data.tenantId,
      })
    );

    if (!versionResult.ok) {
      return toFailure(versionResult.message, "create");
    }

    updateTag(`page-${parsed.data.tenantId}-${result.page.id}`);
  }

  redirect(`/pages/${result.page.id}?created=1`);
};

export const updatePageAction = async (
  _prevState: PageFormState,
  formData: FormData
): Promise<PageFormState> => {
  await assertSameOrigin();
  const parsed = parsePageForm(formData);
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error), "update");
  }
  if (!parsed.data.pageId) {
    return toFailure("更新対象のページ ID が見つかりません。", "update");
  }
  if (!parsed.data.title) {
    return toFailure("タイトルは必須です。", "update");
  }

  const result = await withAdminSessionReauth(() =>
    updatePage({
      displayInFooter: parsed.data.displayInFooter,
      pageId: parsed.data.pageId,
      tenantId: parsed.data.tenantId,
      title: parsed.data.title,
    })
  );

  if (!result.ok) {
    return toFailure(result.message, "update");
  }

  updateTag(`pages-${parsed.data.tenantId}`);
  updateTag(`page-${parsed.data.tenantId}-${parsed.data.pageId}`);

  redirect(`/pages/${parsed.data.pageId}?updated=1`);
};

export const createDraftVersionAction = async (
  _prevState: PageFormState,
  formData: FormData
): Promise<PageFormState> => {
  await assertSameOrigin();
  const parsed = parsePageForm(formData);
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error), "draft");
  }
  if (!parsed.data.pageId) {
    return toFailure("ページ ID が見つかりません。", "draft");
  }

  const result = await withAdminSessionReauth(() =>
    createPageVersion({
      contentMarkdown: parsed.data.contentMarkdown,
      pageId: parsed.data.pageId,
      tenantId: parsed.data.tenantId,
    })
  );

  if (!result.ok) {
    return toFailure(result.message, "draft");
  }

  updateTag(`page-${parsed.data.tenantId}-${parsed.data.pageId}`);

  redirect(`/pages/${parsed.data.pageId}?draft_saved=1`);
};

export const publishVersionAction = async (formData: FormData) => {
  await assertSameOrigin();
  const parsed = parsePageForm(formData);
  if (!parsed.success || !parsed.data.pageId || !parsed.data.versionId) {
    return;
  }

  const result = await withAdminSessionReauth(() =>
    publishPageVersion({
      pageId: parsed.data.pageId,
      tenantId: parsed.data.tenantId,
      versionId: parsed.data.versionId,
    })
  );

  if (!result.ok) {
    throw new Error(result.message);
  }

  updateTag(`pages-${parsed.data.tenantId}`);
  updateTag(`page-${parsed.data.tenantId}-${parsed.data.pageId}`);

  redirect(`/pages/${parsed.data.pageId}?published=1`);
};

export const rollbackVersionAction = async (formData: FormData) => {
  await assertSameOrigin();
  const parsed = parsePageForm(formData);
  if (!parsed.success || !parsed.data.pageId || !parsed.data.versionId) {
    return;
  }

  const result = await withAdminSessionReauth(() =>
    rollbackPageVersion({
      pageId: parsed.data.pageId,
      tenantId: parsed.data.tenantId,
      versionId: parsed.data.versionId,
    })
  );

  if (!result.ok) {
    throw new Error(result.message);
  }

  updateTag(`page-${parsed.data.tenantId}-${parsed.data.pageId}`);

  redirect(`/pages/${parsed.data.pageId}?rolled_back=1`);
};
