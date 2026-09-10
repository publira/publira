import { getMessage } from "@publira/i18n";
import { Input } from "@publira/ui-components/input";

import { CREATOR_ROLE_NAME_MAX_LENGTH } from "#lib/creator-roles-shared";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

/**
 * The field a new role is named in.
 *
 * A `placeholder` cannot be a node, so this one control resolves the catalog
 * itself and is the only thing the caller's `<Suspense>` covers. The card, the
 * label, and the submit button around it stay in the static shell.
 */
export const CreatorRoleNameInput = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return (
    <Input
      className="sm:max-w-sm"
      maxLength={CREATOR_ROLE_NAME_MAX_LENGTH}
      name="name"
      placeholder={getMessage(
        messages,
        "admin.creator_roles.form.name_placeholder"
      )}
      required
      type="text"
    />
  );
};
