import type { UsersFilters } from "./search-params";

/**
 * Why the list came back empty, which decides what the table says. An address
 * on its own is a question about every tenant, so its answer says no tenant
 * has it; once another filter narrows the list, the address may still be held
 * by an account those filters leave out.
 */
export type EmptyListCause = "email" | "filtered" | "none";

export const emptyListCause = (
  filters: Pick<
    UsersFilters,
    "createdFrom" | "createdTo" | "email" | "status" | "tenantQuery"
  >,
  tenantId: string
): EmptyListCause => {
  const narrowed = Boolean(
    filters.status ||
    tenantId ||
    filters.tenantQuery ||
    filters.createdFrom ||
    filters.createdTo
  );

  if (narrowed) {
    return "filtered";
  }

  return filters.email ? "email" : "none";
};
