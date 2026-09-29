import type { SearchParamValue } from "@publira/utils/search-params";
import {
  searchParamEnum,
  searchParamString,
} from "@publira/utils/search-params";
import { z } from "zod";

import { cursorTokenSchema } from "#lib/cursor-token";

interface ParseTenantFiltersInput {
  name?: SearchParamValue;
  status?: SearchParamValue;
  token?: SearchParamValue;
}

export interface TenantFilters {
  name: string;
  status: string;
  token: string;
}

export const buildTenantsPath = ({
  name,
  status,
  token,
}: TenantFilters): string => {
  const search = new URLSearchParams();
  if (name) {
    search.set("name", name);
  }
  if (status) {
    search.set("status", status);
  }
  if (token) {
    search.set("token", token);
  }

  const query = search.toString();
  return query ? `/tenants?${query}` : "/tenants";
};

/**
 * Every filter falls back to the default list view: an unusable query string
 * still renders `/tenants` instead of 404ing an operator out of the list.
 * Cursor tokens stay opaque — they are not trimmed or length-capped here.
 */
const createTenantFiltersSchema = (allowedStatusValues: ReadonlySet<string>) =>
  z.object({
    name: searchParamString({ fallback: "" }),
    status: searchParamEnum(allowedStatusValues, { fallback: "" }),
    token: cursorTokenSchema,
  });

export const parseTenantFilters = (
  input: ParseTenantFiltersInput,
  allowedStatusValues: ReadonlySet<string>
): TenantFilters => createTenantFiltersSchema(allowedStatusValues).parse(input);
