import { getAdminCurrentUser } from "#lib/admin-auth";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";

/**
 * Whether `publicId` is the account the signed-in administrator is using,
 * which `SuspendReader` and `DeleteReader` refuse.
 *
 * Their other guard, the tenant's last active `tenant_admin`, needs no check
 * here. Only an active `tenant_admin` can call them, so on anyone else's page
 * the caller is the other administrator the guard looks for, and on their own
 * page this check already withholds both actions. The API refuses it only when
 * two administrators act on each other at once, and the Action words that
 * refusal.
 *
 * A read that fails without rejecting the session answers no: the buttons are
 * offered, and the API answers a press with the refusal it would have made
 * anyway.
 */
export const isOwnAccount = async (
  tenantId: string,
  publicId: string
): Promise<boolean> => {
  const currentUser = await getAdminCurrentUser(tenantId);
  await redirectToLoginIfSessionRejected(currentUser);

  return currentUser.ok && currentUser.user.publicId === publicId;
};
