import type { SearchParamValue } from "@publira/utils/search-params";
import {
  searchParamEnum,
  searchParamString,
} from "@publira/utils/search-params";
import { z } from "zod";

import { cursorTokenSchema } from "#lib/cursor-token";

interface ParseAuditLogFiltersInput {
  action?: SearchParamValue;
  actor_user_public_id?: SearchParamValue;
  tenant_id?: SearchParamValue;
  token?: SearchParamValue;
}

export interface AuditLogFilters {
  action: string;
  actorUserPublicId: string;
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
    tenantPublicId: parsed.tenant_id,
    token: parsed.token,
  };
};

export const buildAuditLogsPath = ({
  action,
  actorUserPublicId,
  tenantPublicId,
  token,
}: AuditLogFilters): string => {
  const search = new URLSearchParams();
  if (tenantPublicId) {
    search.set("tenant_id", tenantPublicId);
  }
  if (actorUserPublicId) {
    search.set("actor_user_public_id", actorUserPublicId);
  }
  if (action) {
    search.set("action", action);
  }
  if (token) {
    search.set("token", token);
  }
  const query = search.toString();
  return query ? `/audit-logs?${query}` : "/audit-logs";
};
