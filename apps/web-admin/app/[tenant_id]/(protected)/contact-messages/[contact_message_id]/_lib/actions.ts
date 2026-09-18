"use server";

import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { markContactMessageHandled } from "#lib/contact-message";
import { assertSameOrigin } from "#lib/csrf";
import { requiredTrimmedString } from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";

const contactMessageActionSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    publicId: requiredTrimmedString(
      t("admin.contact_messages.validation.target_missing")
    ),
    tenantId: requiredTrimmedString(
      t("admin.contact_messages.validation.tenant_missing")
    ),
  });
};

const contactMessageActionFormFields = {
  publicId: { kind: "value", name: "public_id" },
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

/**
 * States the message's new state and answers where to go next: the returned
 * state is a failure to show beside the button, and success is the message's
 * public id, for the caller to redirect with.
 *
 * The state is stated rather than toggled because the API takes it that way, so
 * two members of staff working the same inbox cannot undo each other by
 * pressing at once.
 */
const mark = async (
  handled: boolean,
  formData: FormData
): Promise<{ publicId: string } | { state: FormActionState }> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await contactMessageActionSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, contactMessageActionFormFields)
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
    markContactMessageHandled({ handled, ...parsed.data }, locale)
  );
  if (!result.ok) {
    return { state: { message: result.message, ok: false } };
  }

  return { publicId: parsed.data.publicId };
};

// Both redirect back to the message rather than refreshing it: the flash flag
// is what raises the toast, since the button that was pressed is replaced by
// the other one once the state changes.
export const markContactMessageHandledAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const outcome = await mark(true, formData);
  if ("state" in outcome) {
    return outcome.state;
  }
  redirect(
    `/contact-messages/${encodeURIComponent(outcome.publicId)}?handled=1`
  );
};

export const reopenContactMessageAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const outcome = await mark(false, formData);
  if ("state" in outcome) {
    return outcome.state;
  }
  redirect(
    `/contact-messages/${encodeURIComponent(outcome.publicId)}?reopened=1`
  );
};
