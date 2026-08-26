"use server";

import { getMessage } from "@publira/utils/i18n";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getPlatformCurrentOperator } from "#lib/auth";
import {
  redirectToLoginIfSessionRejected,
  withPlatformSessionReauth,
} from "#lib/auth-session";
import { requiredTrimmedString } from "#lib/form-schemas";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
import { canManageEndUsers } from "#lib/roles";
import {
  deletePlatformEndUser,
  suspendPlatformEndUser,
  unsuspendPlatformEndUser,
} from "#lib/users";

/**
 * A Server Action's arguments are request input, not a value the page handed
 * over: the endpoint can be invoked directly with anything at all. Same schema
 * the operator Actions use (`operators/[operator_public_id]/_lib/actions.ts`).
 */
const userPublicIdSchema = async () => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return {
    locale,
    schema: requiredTrimmedString(
      getMessage(messages, "platform.common.required")
    ),
  };
};

/**
 * Whether the operator submitting this Action may manage end users, once a
 * rejected session has been sent to login.
 *
 * A Server Action is its own request, so it authenticates independently of the
 * page that rendered the control. Without the redirect a signed-out operator
 * would get the same silent no-op a missing permission gets.
 */
const canCurrentOperatorManageEndUsers = async (): Promise<boolean> => {
  const result = await getPlatformCurrentOperator();
  await redirectToLoginIfSessionRejected(result);
  return result.ok && canManageEndUsers(result.operator.role);
};

export const suspendEndUserAction = async (publicId: string): Promise<void> => {
  const { schema } = await userPublicIdSchema();
  const parsed = schema.safeParse(publicId);
  if (!parsed.success) {
    return;
  }
  const normalizedPublicId = parsed.data;

  if (!(await canCurrentOperatorManageEndUsers())) {
    return;
  }

  await withPlatformSessionReauth(() =>
    suspendPlatformEndUser(normalizedPublicId)
  );
  revalidatePath(`/users/${normalizedPublicId}`);
  revalidatePath("/users");
};

export const unsuspendEndUserAction = async (
  publicId: string
): Promise<void> => {
  const { schema } = await userPublicIdSchema();
  const parsed = schema.safeParse(publicId);
  if (!parsed.success) {
    return;
  }
  const normalizedPublicId = parsed.data;

  if (!(await canCurrentOperatorManageEndUsers())) {
    return;
  }

  await withPlatformSessionReauth(() =>
    unsuspendPlatformEndUser(normalizedPublicId)
  );
  revalidatePath(`/users/${normalizedPublicId}`);
  revalidatePath("/users");
};

export const deleteEndUserAction = async (publicId: string): Promise<void> => {
  const { locale, schema } = await userPublicIdSchema();
  const parsed = schema.safeParse(publicId);
  if (!parsed.success) {
    return;
  }
  const normalizedPublicId = parsed.data;

  if (!(await canCurrentOperatorManageEndUsers())) {
    return;
  }

  const result = await withPlatformSessionReauth(() =>
    deletePlatformEndUser(normalizedPublicId, locale)
  );
  if (!result.ok) {
    return;
  }

  revalidatePath("/users");
  redirect("/users");
};
