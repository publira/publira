import type { SearchParamValue } from "@publira/utils/search-params";
import {
  searchParamDate,
  searchParamEnum,
  searchParamNumber,
  searchParamString,
} from "@publira/utils/search-params";
import { z } from "zod";

export const defaultUsersPageSize = 20;

const pageSizeValues = ["10", "20", "50"] as const;
const statusValues = ["active", "suspended"] as const;

interface ParseUsersFiltersInput {
  created_from?: SearchParamValue;
  created_to?: SearchParamValue;
  limit?: SearchParamValue;
  offset?: SearchParamValue;
  status?: SearchParamValue;
  tenant_id?: SearchParamValue;
  tenant_q?: SearchParamValue;
}

export interface UsersFilters {
  createdFrom: string;
  createdTo: string;
  limit: number;
  offset: number;
  status: string;
  tenantId: string;
  tenantQuery: string;
}

/**
 * Every filter falls back to the default list view: an unusable query string
 * still renders `/users` instead of 404ing an operator out of the list.
 */
const usersFiltersSchema = z.object({
  created_from: searchParamDate({ fallback: "" }),
  created_to: searchParamDate({ fallback: "" }),
  limit: searchParamEnum(pageSizeValues, { fallback: "20" }),
  offset: searchParamNumber({ fallback: 0, min: 0 }),
  status: searchParamEnum(statusValues, { fallback: "" }),
  tenant_id: searchParamString({ fallback: "" }),
  tenant_q: searchParamString({ fallback: "" }),
});

export const parseUsersFilters = (
  input: ParseUsersFiltersInput
): UsersFilters => {
  const parsed = usersFiltersSchema.parse(input);

  return {
    createdFrom: parsed.created_from,
    createdTo: parsed.created_to,
    limit: Number(parsed.limit),
    offset: parsed.offset,
    status: parsed.status,
    tenantId: parsed.tenant_id,
    tenantQuery: parsed.tenant_q,
  };
};

export const buildUsersPath = ({
  createdFrom,
  createdTo,
  limit,
  offset,
  status,
  tenantId,
  tenantQuery,
}: UsersFilters): string => {
  const search = new URLSearchParams();
  if (status) {
    search.set("status", status);
  }
  if (tenantId) {
    search.set("tenant_id", tenantId);
  }
  if (tenantQuery) {
    search.set("tenant_q", tenantQuery);
  }
  if (createdFrom) {
    search.set("created_from", createdFrom);
  }
  if (createdTo) {
    search.set("created_to", createdTo);
  }
  if (limit !== defaultUsersPageSize) {
    search.set("limit", String(limit));
  }
  if (offset > 0) {
    search.set("offset", String(offset));
  }

  const query = search.toString();
  return query ? `/users?${query}` : "/users";
};
