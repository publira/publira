"use client";

import { useParams } from "next/navigation";

/**
 * Client-side tenant id from the root dynamic segment.
 * Prefer this over prop-drilling in Client Components.
 * Server Components should use {@link getTenantId} instead.
 */
export const useTenantId = (): string => {
  const params = useParams();
  const value = params?.tenant_id;

  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
};
