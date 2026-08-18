"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getPlatformCurrentOperator } from "#lib/auth";
import {
  redirectToLoginIfSessionRejected,
  withPlatformSessionReauth,
} from "#lib/auth-session";
import { requiredTrimmedString } from "#lib/form-schemas";
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
const userPublicIdSchema = requiredTrimmedString(
  "必須項目が入力されていません。"
);

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
  const parsed = userPublicIdSchema.safeParse(publicId);
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
  const parsed = userPublicIdSchema.safeParse(publicId);
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
  const parsed = userPublicIdSchema.safeParse(publicId);
  if (!parsed.success) {
    return;
  }
  const normalizedPublicId = parsed.data;

  if (!(await canCurrentOperatorManageEndUsers())) {
    return;
  }

  const result = await withPlatformSessionReauth(() =>
    deletePlatformEndUser(normalizedPublicId)
  );
  if (!result.ok) {
    return;
  }

  revalidatePath("/users");
  redirect("/users");
};
