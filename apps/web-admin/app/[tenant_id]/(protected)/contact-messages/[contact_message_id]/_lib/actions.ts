"use server";

import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import {
  assignContactMessage,
  markContactMessageHandled,
  updateContactMessageStaffNote,
} from "#lib/contact-message";
import { assertSameOrigin } from "#lib/csrf";
import {
  optionalRecordId,
  requiredRecordId,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";

import { CONTACT_MESSAGE_STAFF_NOTE_MAX_LENGTH } from "../../contact-message-types";

const contactMessageActionSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    contactMessageId: requiredRecordId(
      t("admin.contact_messages.validation.target_missing")
    ),
    publicId: requiredTrimmedString(
      t("admin.contact_messages.validation.target_missing")
    ),
    tenantId: requiredTrimmedString(
      t("admin.contact_messages.validation.tenant_missing")
    ),
  });
};

/**
 * `contact_message_id` addresses the message in the API; `public_id` is only
 * the URL the Action redirects back to.
 */
const contactMessageActionFormFields = {
  contactMessageId: { kind: "value", name: "contact_message_id" },
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
    markContactMessageHandled(
      {
        contactMessageId: parsed.data.contactMessageId,
        handled,
        tenantId: parsed.data.tenantId,
      },
      locale
    )
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

const assignActionSchema = async (locale: Locale) => {
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    contactMessageActionSchema(locale),
  ]);

  return schema.extend({
    assigneeUserId: optionalRecordId(
      t("admin.contact_messages.validation.assignee_invalid")
    ),
  });
};

const assignActionFormFields = {
  ...contactMessageActionFormFields,
  assigneeUserId: { kind: "value", name: "assignee_user_id" },
} as const;

/**
 * States who the message is assigned to, and an empty assignee clears it. The
 * picker and "Assign to me" both post here, the latter with the signed-in
 * account's own id.
 *
 * Redirects back to the message like the handled flag does, so the status and
 * the controls are read again rather than patched in place.
 */
export const assignContactMessageAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await assignActionSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, assignActionFormFields)
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    assignContactMessage(
      {
        assigneeUserId: parsed.data.assigneeUserId,
        contactMessageId: parsed.data.contactMessageId,
        tenantId: parsed.data.tenantId,
      },
      locale
    )
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  const flash = parsed.data.assigneeUserId ? "assigned" : "unassigned";
  redirect(
    `/contact-messages/${encodeURIComponent(parsed.data.publicId)}?${flash}=1`
  );
};

const staffNoteActionSchema = async (locale: Locale) => {
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    contactMessageActionSchema(locale),
  ]);

  return schema.extend({
    // Counted in code points rather than by `.max()`, which counts UTF-16 code
    // units and would refuse a note full of emoji the API still accepts.
    staffNote: z.preprocess(
      (value) => (typeof value === "string" ? value.trim() : ""),
      z.string().refine(
        (value) => [...value].length <= CONTACT_MESSAGE_STAFF_NOTE_MAX_LENGTH,
        t("admin.contact_messages.validation.staff_note_too_long", {
          count: String(CONTACT_MESSAGE_STAFF_NOTE_MAX_LENGTH),
        })
      )
    ),
  });
};

const staffNoteActionFormFields = {
  ...contactMessageActionFormFields,
  staffNote: { kind: "value", name: "staff_note" },
} as const;

/**
 * Replaces the message's staff note with the one posted, and an empty note
 * clears it: the API keeps one shared current note, not a history.
 *
 * Redirects back to the message like the other actions on it, so the note is
 * read again rather than kept as the field last held it.
 */
export const updateContactMessageStaffNoteAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await staffNoteActionSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, staffNoteActionFormFields)
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    updateContactMessageStaffNote(
      {
        contactMessageId: parsed.data.contactMessageId,
        staffNote: parsed.data.staffNote,
        tenantId: parsed.data.tenantId,
      },
      locale
    )
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  const flash = parsed.data.staffNote ? "note_saved" : "note_cleared";
  redirect(
    `/contact-messages/${encodeURIComponent(parsed.data.publicId)}?${flash}=1`
  );
};
