"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getPlatformCurrentOperator } from "#lib/auth";
import { canManageEndUsers } from "#lib/roles";
import {
  deletePlatformEndUser,
  suspendPlatformEndUser,
  unsuspendPlatformEndUser,
} from "#lib/users";

export const suspendEndUserAction = async (publicId: string): Promise<void> => {
  const normalizedPublicId = publicId.trim();
  if (!normalizedPublicId) {
    return;
  }

  const me = await getPlatformCurrentOperator();
  if (!canManageEndUsers(me?.role)) {
    return;
  }

  await suspendPlatformEndUser(normalizedPublicId);
  revalidatePath(`/users/${normalizedPublicId}`);
  revalidatePath("/users");
};

export const unsuspendEndUserAction = async (
  publicId: string
): Promise<void> => {
  const normalizedPublicId = publicId.trim();
  if (!normalizedPublicId) {
    return;
  }

  const me = await getPlatformCurrentOperator();
  if (!canManageEndUsers(me?.role)) {
    return;
  }

  await unsuspendPlatformEndUser(normalizedPublicId);
  revalidatePath(`/users/${normalizedPublicId}`);
  revalidatePath("/users");
};

export const deleteEndUserAction = async (publicId: string): Promise<void> => {
  const normalizedPublicId = publicId.trim();
  if (!normalizedPublicId) {
    return;
  }

  const me = await getPlatformCurrentOperator();
  if (!canManageEndUsers(me?.role)) {
    return;
  }

  const result = await deletePlatformEndUser(normalizedPublicId);
  if (!result.ok) {
    return;
  }

  revalidatePath("/users");
  redirect("/users");
};
