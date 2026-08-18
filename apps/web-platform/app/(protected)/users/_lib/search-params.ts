import type { SearchParamValue } from "@publira/utils/search-params";
import {
  searchParamDate,
  searchParamEnum,
  searchParamString,
} from "@publira/utils/search-params";
import { z } from "zod";

import { cursorTokenSchema } from "#lib/cursor-token";
import {
  DEFAULT_LIST_PAGE_SIZE,
  listLimitSearchParam,
} from "#lib/list-pagination";

export const defaultUsersPageSize = DEFAULT_LIST_PAGE_SIZE;

const statusValues = ["active", "suspended"] as const;

interface ParseUsersFiltersInput {
  created_from?: SearchParamValue;
  created_to?: SearchParamValue;
  limit?: SearchParamValue;
  status?: SearchParamValue;
  tenant_id?: SearchParamValue;
  tenant_q?: SearchParamValue;
  token?: SearchParamValue;
}

export interface UsersFilters {
  createdFrom: string;
  createdTo: string;
  limit: number;
  status: string;
  tenantId: string;
  tenantQuery: string;
  token: string;
}

/**
 * Every filter falls back to the default list view: an unusable query string
 * still renders `/users` instead of 404ing an operator out of the list.
 * Cursor tokens stay opaque — they are not trimmed or length-capped here.
 */
const usersFiltersSchema = z.object({
  created_from: searchParamDate({ fallback: "" }),
  created_to: searchParamDate({ fallback: "" }),
  limit: listLimitSearchParam,
  status: searchParamEnum(statusValues, { fallback: "" }),
  tenant_id: searchParamString({ fallback: "" }),
  tenant_q: searchParamString({ fallback: "" }),
  token: cursorTokenSchema,
});

export const parseUsersFilters = (
  input: ParseUsersFiltersInput
): UsersFilters => {
  const parsed = usersFiltersSchema.parse(input);

  return {
    createdFrom: parsed.created_from,
    createdTo: parsed.created_to,
    limit: Number(parsed.limit),
    status: parsed.status,
    tenantId: parsed.tenant_id,
    tenantQuery: parsed.tenant_q,
    token: parsed.token,
  };
};

export const buildUsersPath = ({
  createdFrom,
  createdTo,
  limit,
  status,
  tenantId,
  tenantQuery,
  token,
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
  if (token) {
    search.set("token", token);
  }

  const query = search.toString();
  return query ? `/users?${query}` : "/users";
};
