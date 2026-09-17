"use server";

import type { Locale } from "@publira/i18n";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { requiredTrimmedString } from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import { moderateReader } from "#lib/reader";
import type { ReaderModerationAction } from "#lib/reader";

import type { ReaderActionState } from "../../reader-types";

const readerActionSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    publicId: requiredTrimmedString(
      t("admin.readers.validation.target_missing")
    ),
    tenantId: requiredTrimmedString(
      t("admin.readers.validation.tenant_missing")
    ),
  });
};

const readerActionFormFields = {
  publicId: { kind: "value", name: "public_id" },
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

const moderate = async (
  action: ReaderModerationAction,
  formData: FormData
): Promise<{ message: string; ok: boolean }> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await readerActionSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, readerActionFormFields)
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    moderateReader({ action, ...parsed.data }, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return { message: "", ok: true };
};

export const suspendReaderAction = async (
  _prevState: ReaderActionState,
  formData: FormData
): Promise<ReaderActionState> => {
  const state = await moderate("suspend", formData);
  if (state.ok) {
    // Reader reads are uncached, so re-rendering the route is what brings the
    // new status onto the page.
    refresh();
  }
  return state;
};

export const unsuspendReaderAction = async (
  _prevState: ReaderActionState,
  formData: FormData
): Promise<ReaderActionState> => {
  const state = await moderate("unsuspend", formData);
  if (state.ok) {
    refresh();
  }
  return state;
};

export const deleteReaderAction = async (
  _prevState: ReaderActionState,
  formData: FormData
): Promise<ReaderActionState> => {
  const state = await moderate("delete", formData);
  if (state.ok) {
    // The detail page is gone with the account, so the list confirms it.
    redirect("/readers?deleted=1");
  }
  return state;
};
