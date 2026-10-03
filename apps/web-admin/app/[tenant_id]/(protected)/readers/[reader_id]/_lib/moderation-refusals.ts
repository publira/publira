import type { Locale } from "@publira/i18n";

import { getAdminCurrentUser } from "#lib/admin-auth";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { hasOtherActiveTenantAdmin } from "#lib/tenant-members";

import type { ReaderDetail } from "../../reader-types";

/**
 * Why the API would refuse to suspend or delete an account, worked out before
 * the page offers either action. Both mirror a guard of `SuspendReader` and
 * `DeleteReader`; the API stays the authority, and words its own refusal for
 * an account that changed after the page was drawn.
 */
export interface ReaderModerationRefusals {
  /** The tenant's last active `tenant_admin`, whom the API keeps. */
  lastTenantAdmin: boolean;
  /** The account the signed-in administrator is using. */
  ownAccount: boolean;
}

/**
 * A read that fails without rejecting the session refuses nothing: the
 * buttons are offered, and the API answers a press with the refusal it would
 * have made anyway.
 */
export const readerModerationRefusals = async (
  tenantId: string,
  locale: Locale,
  reader: Pick<ReaderDetail, "id" | "publicId" | "role">
): Promise<ReaderModerationRefusals> => {
  // The API refuses only an account holding `tenant_admin`, so nobody else
  // needs the member list paged through.
  const [currentUser, otherAdmin] = await Promise.all([
    getAdminCurrentUser(tenantId),
    reader.role === "tenant_admin"
      ? hasOtherActiveTenantAdmin(tenantId, locale, reader.id)
      : ({ ok: true, value: true } as const),
  ]);

  await redirectToLoginIfSessionRejected(currentUser, otherAdmin);

  return {
    lastTenantAdmin: otherAdmin.ok && !otherAdmin.value,
    ownAccount: currentUser.ok && currentUser.user.publicId === reader.publicId,
  };
};
