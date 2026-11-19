import type { SearchParamValue } from "@publira/utils/search-params";
import {
  searchParamDate,
  searchParamEnum,
  searchParamString,
} from "@publira/utils/search-params";
import { z } from "zod";

import { cursorTokenSchema } from "#lib/cursor-token";

interface ParseAuditLogFiltersInput {
  action?: SearchParamValue;
  actor_user_public_id?: SearchParamValue;
  created_from?: SearchParamValue;
  created_to?: SearchParamValue;
  tenant_id?: SearchParamValue;
  token?: SearchParamValue;
}

export interface AuditLogFilters {
  action: string;
  actorUserPublicId: string;
  /**
   * The first and last day of the period, inclusive, as calendar days of the
   * platform's default time zone (`YYYY-MM-DD`). Empty leaves that end open.
   */
  createdFrom: string;
  createdTo: string;
  /**
   * The tenant the list is narrowed to, by public ID: the ID a tenant's URL
   * already names, so a link from `/tenants/<public ID>` carries the same value.
   * The page resolves it to the internal ID `ListAuditLogs` filters on.
   */
  tenantPublicId: string;
  token: string;
}

export const toAllowedActionValues = (
  options: readonly { value: string }[]
): ReadonlySet<string> => {
  const allowedActionValues = new Set<string>();

  for (const option of options) {
    if (option.value) {
      allowedActionValues.add(option.value);
    }
  }

  return allowedActionValues;
};

/**
 * Every filter falls back to the default list view: an unusable query string
 * still renders `/audit-logs` instead of 404ing an operator out of the log.
 * Cursor tokens stay opaque — they are not trimmed or length-capped here.
 */
const createAuditLogFiltersSchema = (
  allowedActionValues: ReadonlySet<string>
) =>
  z.object({
    action: searchParamEnum(allowedActionValues, { fallback: "" }),
    actor_user_public_id: searchParamString({ fallback: "" }),
    created_from: searchParamDate({ fallback: "" }),
    created_to: searchParamDate({ fallback: "" }),
    tenant_id: searchParamString({ fallback: "" }),
    token: cursorTokenSchema,
  });

export const parseAuditLogFilters = (
  input: ParseAuditLogFiltersInput,
  allowedActionValues: ReadonlySet<string>
): AuditLogFilters => {
  const parsed = createAuditLogFiltersSchema(allowedActionValues).parse(input);

  return {
    action: parsed.action,
    actorUserPublicId: parsed.actor_user_public_id,
    createdFrom: parsed.created_from,
    createdTo: parsed.created_to,
    tenantPublicId: parsed.tenant_id,
    token: parsed.token,
  };
};
