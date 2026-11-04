"use client";

import * as Identifier from "@publira/ui-components/identifier";

import { useClientMessages } from "#components/client-message";

/** The tenant's ID, which a request made with a key names the tenant by. */
export const TenantIdCopy = ({ tenantId }: { tenantId: string }) => {
  const t = useClientMessages();

  return (
    <Identifier.Root>
      <Identifier.Value>{tenantId}</Identifier.Value>
      <Identifier.Copy
        aria-label={t("admin.settings.api_keys.copy_tenant_id")}
        value={tenantId}
      />
    </Identifier.Root>
  );
};
