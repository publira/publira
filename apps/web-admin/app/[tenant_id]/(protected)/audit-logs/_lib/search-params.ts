import type { SearchParamValue } from "@publira/utils/search-params";
import {
  searchParamDate,
  searchParamEnum,
  searchParamString,
} from "@publira/utils/search-params";
import { z } from "zod";

interface ParseAuditLogFiltersInput {
  action?: SearchParamValue;
  actor?: SearchParamValue;
  from?: SearchParamValue;
  token?: SearchParamValue;
  to?: SearchParamValue;
}

export interface AuditLogFilters {
  action: string;
  actor: string;
  from: string;
  token: string;
  to: string;
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
 * Every filter falls back to `""`, the "no filter" value this screen already
 * uses: an unusable query string still renders the default view instead of
 * 404ing an operator out of the audit log.
 */
const createAuditLogFiltersSchema = (
  allowedActionValues: ReadonlySet<string>
) =>
  z.object({
    action: searchParamEnum(allowedActionValues, { fallback: "" }),
    actor: searchParamString({ fallback: "" }),
    from: searchParamDate({ fallback: "" }),
    to: searchParamDate({ fallback: "" }),
    token: searchParamString({ fallback: "" }),
  });

export const parseAuditLogFilters = (
  input: ParseAuditLogFiltersInput,
  allowedActionValues: ReadonlySet<string>
): AuditLogFilters =>
  createAuditLogFiltersSchema(allowedActionValues).parse(input);
