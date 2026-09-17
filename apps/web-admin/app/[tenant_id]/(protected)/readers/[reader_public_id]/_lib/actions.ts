"use server";

import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
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
import { moderateReader, setReaderBirthDate } from "#lib/reader";
import type { ReaderModerationAction } from "#lib/reader";

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

/**
 * Runs one moderation action and answers where to go next: the returned state
 * is a failure to show beside the button, and success is the reader's public
 * id, for the caller to redirect with.
 */
const moderate = async (
  action: ReaderModerationAction,
  formData: FormData
): Promise<{ publicId: string } | { state: FormActionState }> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await readerActionSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, readerActionFormFields)
  );
  if (!parsed.success) {
    return {
      state: {
        message: toFormErrorMessage(parsed.error, { locale }),
        ok: false,
      },
    };
  }

  const result = await withAdminSessionReauth(() =>
    moderateReader({ action, ...parsed.data }, locale)
  );
  if (!result.ok) {
    return { state: { message: result.message, ok: false } };
  }

  return { publicId: parsed.data.publicId };
};

// Suspend and unsuspend redirect back to the page rather than refreshing it:
// the flash flag is what raises the toast, since the button that was pressed
// is replaced by the other one once the status changes.
export const suspendReaderAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const outcome = await moderate("suspend", formData);
  if ("state" in outcome) {
    return outcome.state;
  }
  redirect(`/readers/${encodeURIComponent(outcome.publicId)}?suspended=1`);
};

export const unsuspendReaderAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const outcome = await moderate("unsuspend", formData);
  if ("state" in outcome) {
    return outcome.state;
  }
  redirect(`/readers/${encodeURIComponent(outcome.publicId)}?unsuspended=1`);
};

const birthDateFormFields = {
  ...readerActionFormFields,
  birthDate: { kind: "value", name: "birth_date" },
} as const;

/** An empty date clears the stored one; the API validates a present one. */
export const setReaderBirthDateAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const readerSchema = await readerActionSchema(locale);
  const schema = readerSchema.extend({ birthDate: optionalTrimmedString() });
  const parsed = schema.safeParse(
    toFormDataInput(formData, birthDateFormFields)
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    setReaderBirthDate(parsed.data, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  redirect(
    `/readers/${encodeURIComponent(parsed.data.publicId)}?birth_date_updated=1`
  );
};

export const deleteReaderAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const outcome = await moderate("delete", formData);
  if ("state" in outcome) {
    return outcome.state;
  }
  // The detail page is gone with the account, so the list confirms it.
  redirect("/readers?deleted=1");
};
