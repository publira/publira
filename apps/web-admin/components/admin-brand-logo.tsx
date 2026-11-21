import { getMessages } from "#lib/get-messages";
import type { TenantBrandingImageVariant } from "#lib/tenant-branding-image";

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
  const t = await getMessages();

  return (
    <TenantBrandLogo
      alt={t("admin.shell.logo_alt", { name: tenantName })}
      className={className}
      priority={priority}
      variant={variant}
    />
  );
};
