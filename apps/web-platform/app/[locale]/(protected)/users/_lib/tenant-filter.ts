export type TenantFilterResolution =
  | { kind: "resolved"; tenantId: string }
  | { kind: "unselected" }
  | { kind: "none" }
  | { kind: "ambiguous" };

export const resolveTenantFilter = ({
  matches,
  searchOk,
  tenantId,
  tenantQuery,
}: {
  matches: readonly { publicId: string }[];
  searchOk: boolean;
  tenantId: string;
  tenantQuery: string;
}): TenantFilterResolution => {
  if (!tenantQuery) {
    return tenantId ? { kind: "resolved", tenantId } : { kind: "unselected" };
  }

  // A failed search must not drop a tenant the URL already named.
  if (!searchOk) {
    return tenantId ? { kind: "resolved", tenantId } : { kind: "unselected" };
  }

  if (tenantId && matches.some((tenant) => tenant.publicId === tenantId)) {
    return { kind: "resolved", tenantId };
  }

  if (matches.length === 1) {
    return { kind: "resolved", tenantId: matches[0].publicId };
  }

  return matches.length === 0 ? { kind: "none" } : { kind: "ambiguous" };
};

export const resolvedTenantId = (resolution: TenantFilterResolution): string =>
  resolution.kind === "resolved" ? resolution.tenantId : "";
