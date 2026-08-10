import { z } from "zod";

const maxSearchParamLength = 255;
const dateParamPattern = /^\d{4}-\d{2}-\d{2}$/u;

type QueryParamValue = string | string[] | undefined;

interface ParseAuditLogFiltersInput {
  action?: QueryParamValue;
  actor?: QueryParamValue;
  from?: QueryParamValue;
  token?: QueryParamValue;
  to?: QueryParamValue;
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

const singleSearchParamSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : ""),
  z
    .string()
    .transform((value) => (value.length <= maxSearchParamLength ? value : ""))
);

const createAuditLogFiltersSchema = (
  allowedActionValues: ReadonlySet<string>
) =>
  z.object({
    action: singleSearchParamSchema.transform((value) =>
      value && allowedActionValues.has(value) ? value : ""
    ),
    actor: singleSearchParamSchema,
    from: singleSearchParamSchema.transform((value) =>
      dateParamPattern.test(value) ? value : ""
    ),
    to: singleSearchParamSchema.transform((value) =>
      dateParamPattern.test(value) ? value : ""
    ),
    token: singleSearchParamSchema,
  });

export const parseAuditLogFilters = (
  input: ParseAuditLogFiltersInput,
  allowedActionValues: ReadonlySet<string>
): AuditLogFilters =>
  createAuditLogFiltersSchema(allowedActionValues).parse(input);
