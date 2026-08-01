import { guardPlaceholder } from "@publira/utils/next-static-params";
import { notFound } from "next/navigation";
import { tenant_id } from "next/root-params";

/**
 * Resolve the current request's tenant id from the root dynamic segment.
 * Prefer this over prop-drilling `params.tenant_id` in Server Components.
 *
 * Note: `next/root-params` is not available in Server Actions or Route Handlers.
 */
export const getTenantId = async (): Promise<string> => {
  const value = await tenant_id();
  if (typeof value !== "string" || !value.trim()) {
    notFound();
  }
  guardPlaceholder(value);
  return value;
};
