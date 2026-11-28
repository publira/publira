"use server";

import type { Locale } from "@publira/i18n";
import type * as ActionForm from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { platformAuditLogsCacheTag } from "#lib/audit-logs";
import { getPlatformCurrentOperator } from "#lib/auth";
import {
  redirectToLoginIfSessionRejected,
  withPlatformSessionReauth,
} from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { platformDashboardCacheTag } from "#lib/dashboard";
import { requiredRecordId } from "#lib/form-schemas";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { canManageEndUsers } from "#lib/roles";
import {
  deletePlatformEndUser,
  platformEndUsersCacheTag,
  suspendPlatformEndUser,
  unsuspendPlatformEndUser,
} from "#lib/users";

/**
 * Whether the operator submitting this Action may manage end users, once a
 * rejected session has been sent to login.
 *
 * A Server Action is its own request, so it authenticates independently of the
 * page that rendered the control. Without the redirect a signed-out operator
 * would be told they lack a permission they may well have.
 */
const canCurrentOperatorManageEndUsers = async (): Promise<boolean> => {
  const result = await getPlatformCurrentOperator();
  await redirectToLoginIfSessionRejected(result);

  return result.ok && canManageEndUsers(result.operator.role);
};

/**
 * The end user the form names, once the caller has been confirmed as an
 * operator who may manage end users, or the refusal to show instead.
 */
const resolveEndUserTarget = async (
  formData: FormData,
  locale: Locale
): Promise<{ ok: true; userId: string } | { message: string; ok: false }> => {
  const t = await getMessagesFor(locale);

  const schema = z.object({
    userId: requiredRecordId(t("platform.common.required")),
  });

  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      userId: { kind: "value", name: "user_id" },
    })
  );

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  if (!(await canCurrentOperatorManageEndUsers())) {
    return { message: t("errors.rpc.forbidden"), ok: false };
  }

  return { ok: true, userId: parsed.data.userId };
};

const clearEndUserTags = () => {
  updateTag(platformEndUsersCacheTag);
  updateTag(platformDashboardCacheTag);
  updateTag(platformAuditLogsCacheTag);
};

/**
 * Success returns no message: the page renders the account's new status, and
 * the control that reverses the change in place of this one.
 */
export const suspendEndUserAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const resolved = await resolveEndUserTarget(formData, locale);

  if (!resolved.ok) {
    return resolved;
  }

  const result = await withPlatformSessionReauth(() =>
    suspendPlatformEndUser(resolved.userId, locale)
  );

  if (!result.ok) {
    return result;
  }

  clearEndUserTags();

  return { message: "", ok: true };
};

export const unsuspendEndUserAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const resolved = await resolveEndUserTarget(formData, locale);

  if (!resolved.ok) {
    return resolved;
  }

  const result = await withPlatformSessionReauth(() =>
    unsuspendPlatformEndUser(resolved.userId, locale)
  );

  if (!result.ok) {
    return result;
  }

  clearEndUserTags();

  return { message: "", ok: true };
};

/** Leaves for the user list once the account is deleted, and only then. */
export const deleteEndUserAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const resolved = await resolveEndUserTarget(formData, locale);

  if (!resolved.ok) {
    return resolved;
  }

  const result = await withPlatformSessionReauth(() =>
    deletePlatformEndUser(resolved.userId, locale)
  );

  if (!result.ok) {
    return result;
  }

  clearEndUserTags();
  redirect("/users");
};
