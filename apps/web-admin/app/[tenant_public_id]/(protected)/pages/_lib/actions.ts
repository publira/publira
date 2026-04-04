"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";

import {
  createPage,
  createPageVersion,
  publishPageVersion,
  rollbackPageVersion,
  updatePage,
} from "#lib/page";

import { normalizePageSlugInput } from "../page-types";
import type { PageFormState } from "../page-types";

const parseCommonFields = (formData: FormData) => ({
  pageId: String(formData.get("page_id") ?? "").trim(),
  slug: String(formData.get("slug") ?? "").trim(),
  tenantPublicId: String(formData.get("tenant_public_id") ?? "").trim(),
  title: String(formData.get("title") ?? "").trim(),
  versionId: String(formData.get("version_id") ?? "").trim(),
});

type PageActionMode = "create" | "update" | "draft";

const validateTenant = (
  tenantPublicId: string,
  mode: PageActionMode
): PageFormState => {
  if (tenantPublicId) {
    return null;
  }

  return {
    message: "テナント ID が見つかりません。",
    mode,
    ok: false,
  };
};

export const createPageAction = async (
  _prevState: PageFormState,
  formData: FormData
): Promise<PageFormState> => {
  const input = parseCommonFields(formData);
  input.slug = normalizePageSlugInput(input.slug);
  const contentMarkdown = String(formData.get("content_markdown") ?? "");
  const tenantValidation = validateTenant(input.tenantPublicId, "create");
  if (tenantValidation) {
    return tenantValidation;
  }
  if (!input.title) {
    return {
      message: "タイトルは必須です。",
      mode: "create",
      ok: false,
    };
  }

  const result = await createPage({
    slug: input.slug,
    tenantPublicId: input.tenantPublicId,
    title: input.title,
  });

  if (!result.ok) {
    return {
      message: result.message,
      mode: "create",
      ok: false,
    };
  }

  updateTag(`pages-${input.tenantPublicId}`);

  if (contentMarkdown.trim()) {
    const versionResult = await createPageVersion({
      contentMarkdown,
      pageId: result.page.id,
      tenantPublicId: input.tenantPublicId,
    });

    if (!versionResult.ok) {
      return {
        message: versionResult.message,
        mode: "create",
        ok: false,
      };
    }

    updateTag(`page-${input.tenantPublicId}-${result.page.id}`);
  }

  redirect(`/pages/${result.page.id}?created=1`);
};

export const updatePageAction = async (
  _prevState: PageFormState,
  formData: FormData
): Promise<PageFormState> => {
  const input = parseCommonFields(formData);
  const tenantValidation = validateTenant(input.tenantPublicId, "update");
  if (tenantValidation) {
    return tenantValidation;
  }
  if (!input.pageId) {
    return {
      message: "更新対象のページ ID が見つかりません。",
      mode: "update",
      ok: false,
    };
  }
  if (!input.title) {
    return {
      message: "タイトルは必須です。",
      mode: "update",
      ok: false,
    };
  }

  const result = await updatePage({
    pageId: input.pageId,
    tenantPublicId: input.tenantPublicId,
    title: input.title,
  });

  if (!result.ok) {
    return {
      message: result.message,
      mode: "update",
      ok: false,
    };
  }

  updateTag(`pages-${input.tenantPublicId}`);
  updateTag(`page-${input.tenantPublicId}-${input.pageId}`);

  redirect(`/pages/${input.pageId}?title_updated=1`);
};

export const createDraftVersionAction = async (
  _prevState: PageFormState,
  formData: FormData
): Promise<PageFormState> => {
  const input = parseCommonFields(formData);
  const tenantValidation = validateTenant(input.tenantPublicId, "draft");
  if (tenantValidation) {
    return tenantValidation;
  }
  if (!input.pageId) {
    return {
      message: "ページ ID が見つかりません。",
      mode: "draft",
      ok: false,
    };
  }

  const contentMarkdown = String(formData.get("content_markdown") ?? "");
  const result = await createPageVersion({
    contentMarkdown,
    pageId: input.pageId,
    tenantPublicId: input.tenantPublicId,
  });

  if (!result.ok) {
    return {
      message: result.message,
      mode: "draft",
      ok: false,
    };
  }

  updateTag(`page-${input.tenantPublicId}-${input.pageId}`);

  redirect(`/pages/${input.pageId}?draft_saved=1`);
};

export const publishVersionAction = async (formData: FormData) => {
  const input = parseCommonFields(formData);
  if (!input.tenantPublicId || !input.pageId || !input.versionId) {
    return;
  }

  const result = await publishPageVersion({
    pageId: input.pageId,
    tenantPublicId: input.tenantPublicId,
    versionId: input.versionId,
  });

  if (!result.ok) {
    throw new Error(result.message);
  }

  updateTag(`pages-${input.tenantPublicId}`);
  updateTag(`page-${input.tenantPublicId}-${input.pageId}`);

  redirect(`/pages/${input.pageId}?published=1`);
};

export const rollbackVersionAction = async (formData: FormData) => {
  const input = parseCommonFields(formData);
  if (!input.tenantPublicId || !input.pageId || !input.versionId) {
    return;
  }

  const result = await rollbackPageVersion({
    pageId: input.pageId,
    tenantPublicId: input.tenantPublicId,
    versionId: input.versionId,
  });

  if (!result.ok) {
    throw new Error(result.message);
  }

  updateTag(`page-${input.tenantPublicId}-${input.pageId}`);

  redirect(`/pages/${input.pageId}?rolled_back=1`);
};