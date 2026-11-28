"use server";

import type { Locale } from "@publira/i18n";
import type * as ActionForm from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { platformAuditLogsCacheTag } from "#lib/audit-logs";
import type { PlatformCurrentOperator } from "#lib/auth";
import { getPlatformCurrentOperator } from "#lib/auth";
import {
  redirectToLoginIfSessionRejected,
  withPlatformSessionReauth,
} from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { platformDashboardCacheTag } from "#lib/dashboard";
import { requiredRecordId, requiredTrimmedString } from "#lib/form-schemas";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import type { PlatformMessageAccessor } from "#lib/messages";
import {
  deactivatePlatformOperator,
  platformOperatorsCacheTag,
  suspendPlatformOperator,
  unsuspendPlatformOperator,
  updatePlatformOperatorRole,
} from "#lib/operators";
import type { PlatformOperatorSummary } from "#lib/operators";
import { isPlatformSuperAdmin } from "#lib/roles";

/**
 * The operator an Action acts on: the RPC addresses it by `id`, and `publicId`
 * is what `GetMe` names the signed-in operator by, for the self check.
 */
type OperatorTarget = Pick<PlatformOperatorSummary, "id" | "publicId">;

const operatorTargetSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);
  const message = t("platform.common.required");

  return z.object({
    id: requiredRecordId(message),
    publicId: requiredTrimmedString(message),
  });
};

/**
 * The operator submitting this Action, once a rejected session has been sent to
 * login.
 *
 * A Server Action is its own request, so it authenticates independently of the
 * page that rendered the control. A rejected session used to arrive as the same
 * `null` a `GetMe` without an operator does, and "You do not have permission to
 * perform this action." next to a button is a dead end for someone who has
 * simply been signed out.
 */
const resolveCurrentOperator =
  async (): Promise<PlatformCurrentOperator | null> => {
    const result = await getPlatformCurrentOperator();
    await redirectToLoginIfSessionRejected(result);

    return result.ok ? result.operator : null;
  };

const updateOperatorRoleFormSchema = async (locale: Locale) => {
  const [t, target] = await Promise.all([
    getMessagesFor(locale),
    operatorTargetSchema(locale),
  ]);

  const required = t("platform.common.required");

  return target.extend({
    role: z.enum(
      ["platform_auditor", "platform_operator", "platform_super_admin"],
      { error: required }
    ),
  });
};

export const updateOperatorRoleAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();

  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    updateOperatorRoleFormSchema(locale),
  ]);

  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      id: { kind: "value", name: "operator_id" },
      publicId: { kind: "value", name: "operator_public_id" },
      role: { kind: "value", name: "operator_role" },
    })
  );

  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const { id, publicId, role } = parsed.data;

  const me = await resolveCurrentOperator();

  if (!(me && isPlatformSuperAdmin(me.role))) {
    return {
      message: t("errors.rpc.forbidden"),
      ok: false,
    };
  }

  if (me.publicId === publicId) {
    return {
      message: t("platform.operators.cannot_change_own_role"),
      ok: false,
    };
  }

  const result = await withPlatformSessionReauth(() =>
    updatePlatformOperatorRole({
      locale,
      role,
      operatorId: id,
    })
  );

  updateTag(platformOperatorsCacheTag);
  updateTag(platformDashboardCacheTag);
  updateTag(platformAuditLogsCacheTag);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return {
    message: t("platform.operators.role_updated"),
    ok: true,
  };
};

/**
 * The operator a status change names, once the caller has been confirmed as a
 * super admin who may change it, or the refusal to show instead. `self` is
 * what refuses a change the caller may not make to their own account; leaving
 * it out lets them, which only reactivating does, since a suspended operator
 * cannot be the one signed in.
 */
const resolveStatusChangeTarget = async (
  formData: FormData,
  locale: Locale,
  self?: (t: PlatformMessageAccessor) => string
): Promise<
  { ok: true; target: OperatorTarget } | { message: string; ok: false }
> => {
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    operatorTargetSchema(locale),
  ]);

  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      id: { kind: "value", name: "operator_id" },
      publicId: { kind: "value", name: "operator_public_id" },
    })
  );

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const me = await resolveCurrentOperator();

  if (!(me && isPlatformSuperAdmin(me.role))) {
    return { message: t("errors.rpc.forbidden"), ok: false };
  }

  if (self && me.publicId === parsed.data.publicId) {
    return { message: self(t), ok: false };
  }

  return { ok: true, target: parsed.data };
};

/**
 * Success returns no message: the page renders the operator's new status, and
 * the control that reverses the change in place of this one.
 */
export const suspendOperatorAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();

  const resolved = await resolveStatusChangeTarget(formData, locale, (t) =>
    t("platform.operators.cannot_suspend_self")
  );

  if (!resolved.ok) {
    return resolved;
  }

  const result = await withPlatformSessionReauth(() =>
    suspendPlatformOperator(resolved.target.id, locale)
  );

  if (!result.ok) {
    return result;
  }

  updateTag(platformOperatorsCacheTag);
  updateTag(platformAuditLogsCacheTag);

  return { message: "", ok: true };
};

export const unsuspendOperatorAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const resolved = await resolveStatusChangeTarget(formData, locale);

  if (!resolved.ok) {
    return resolved;
  }

  const result = await withPlatformSessionReauth(() =>
    unsuspendPlatformOperator(resolved.target.id, locale)
  );

  if (!result.ok) {
    return result;
  }

  updateTag(platformOperatorsCacheTag);
  updateTag(platformAuditLogsCacheTag);

  return { message: "", ok: true };
};

/** Leaves for the operator list once the account is deactivated, and only then. */
export const deactivateOperatorAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();

  const resolved = await resolveStatusChangeTarget(formData, locale, (t) =>
    t("platform.operators.cannot_deactivate_self")
  );

  if (!resolved.ok) {
    return resolved;
  }

  const result = await withPlatformSessionReauth(() =>
    deactivatePlatformOperator(resolved.target.id, locale)
  );

  if (!result.ok) {
    return result;
  }

  updateTag(platformOperatorsCacheTag);
  updateTag(platformDashboardCacheTag);
  updateTag(platformAuditLogsCacheTag);
  redirect("/operators");
};
