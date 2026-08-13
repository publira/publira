export const resolveTenantFilterId = ({
  matches,
  searchOk,
  tenantId,
  tenantQuery,
}: {
  matches: readonly { publicId: string }[];
  searchOk: boolean;
  tenantId: string;
  tenantQuery: string;
}): string => {
  if (!tenantQuery) {
    return tenantId;
  }

  // A failed search must not drop a tenant the URL already named.
  if (!searchOk) {
    return tenantId;
  }

  if (tenantId && matches.some((tenant) => tenant.publicId === tenantId)) {
    return tenantId;
  }

  if (matches.length === 1) {
    return matches[0].publicId;
  }

  return "";
};
