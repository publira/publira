"use server";

import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { emailFormSchema, tenantIdFormSchema } from "#lib/auth-input";
import { submitContactMessage } from "#lib/contact";
import { assertSameOrigin } from "#lib/csrf";
import {
  LOCALE_FIELD_NAME,
  localeFormSchema,
  requireFormLocale,
} from "#lib/locale-form";
import { getMessagesFor } from "#lib/messages";
import { tenantLocalePath } from "#lib/tenant-locale-path";

/**
 * The limits `SubmitContactMessage` enforces, counted the way it counts them:
 * the address in bytes, the length a mailbox may have, and the subject and body
 * in Unicode code points.
 */
const MAX_REPLY_TO_BYTES = 254;
const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 4000;

const codePoints = (value: string): number => [...value].length;

const contactFormSchema = async (locale: Locale) => {
  const [t, email, tenantId] = await Promise.all([
    getMessagesFor(locale),
    emailFormSchema(locale),
    tenantIdFormSchema(locale),
  ]);

  return z.object({
    body: z
      .string()
      .trim()
      .min(1, { error: t("host.contact.body_required") })
      .refine((value) => codePoints(value) <= MAX_BODY_LENGTH, {
        error: t("host.contact.body_too_long", { max: MAX_BODY_LENGTH }),
      }),
    locale: localeFormSchema,
    replyToEmail: email.refine(
      (value) => new TextEncoder().encode(value).length <= MAX_REPLY_TO_BYTES,
      { error: t("host.contact.email_too_long") }
    ),
    subject: z
      .string()
      .trim()
      .refine((value) => codePoints(value) <= MAX_SUBJECT_LENGTH, {
        error: t("host.contact.subject_too_long", { max: MAX_SUBJECT_LENGTH }),
      }),
    tenantId,
  });
};

/**
 * Send the contact form, then show the reader that it went.
 *
 * A rejection comes back as the form's message and leaves the fields as the
 * reader wrote them; an accepted message redirects, so reloading the page it
 * lands on cannot send it a second time.
 */
export const submitContactMessageAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  // The locale field parses on its own — it throws rather than falling back —
  // so every rejection below is worded in the reader's language.
  const submittedLocale = requireFormLocale(formData.get(LOCALE_FIELD_NAME));
  const schema = await contactFormSchema(submittedLocale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      body: "value",
      locale: "value",
      replyToEmail: "value",
      subject: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale: submittedLocale }),
      ok: false,
    };
  }

  const { body, locale, replyToEmail, subject, tenantId } = parsed.data;
  const result = await submitContactMessage({
    body,
    locale,
    replyToEmail,
    subject,
    tenantId,
  });
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  redirect(await tenantLocalePath(tenantId, locale, "/contact/sent"));
};
