import { z } from "zod";

const maxSearchParamLength = 255;

type QueryParamValue = string | string[] | undefined;

interface ParseTenantFiltersInput {
  name?: QueryParamValue;
  status?: QueryParamValue;
  token?: QueryParamValue;
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

const singleSearchParamSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : ""),
  z
    .string()
    .transform((value) => (value.length <= maxSearchParamLength ? value : ""))
);

const cursorTokenSchema = z.preprocess(
  (value) => (typeof value === "string" ? value : ""),
  z.string()
);

const createTenantFiltersSchema = (allowedStatusValues: ReadonlySet<string>) =>
  z.object({
    name: singleSearchParamSchema,
    status: singleSearchParamSchema.transform((value) =>
      value && allowedStatusValues.has(value) ? value : ""
    ),
    token: cursorTokenSchema,
  });

export const parseTenantFilters = (
  input: ParseTenantFiltersInput,
  allowedStatusValues: ReadonlySet<string>
): TenantFilters => createTenantFiltersSchema(allowedStatusValues).parse(input);
