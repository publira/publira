import { getMessage } from "@publira/i18n";

import { getLocale, loadAdminMessages } from "#lib/locale";
import type { TenantBrandingImageVariant } from "#lib/tenant-branding-image";
import { getTenantId } from "#lib/tenant-id";

import { TenantBrandLogo } from "./tenant-brand-logo";

/**
 * The tenant logo, with its alternative text resolved from the catalog.
 *
 * `alt` is an attribute rather than a node, so it cannot stream the way the
 * rest of the shell's copy does: this one control resolves the catalog itself
 * and waits behind its own `<Suspense>`, while the header and the sidebar
 * around it keep rendering.
 */
export const AdminBrandLogo = async ({
  className,
  priority,
  tenantName,
  variant,
}: {
  className?: string;
  priority?: boolean;
  tenantName: string;
  variant: TenantBrandingImageVariant;
}) => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return (
    <TenantBrandLogo
      alt={getMessage(messages, "admin.shell.logo_alt", { name: tenantName })}
      className={className}
      priority={priority}
      variant={variant}
    />
  );
};
