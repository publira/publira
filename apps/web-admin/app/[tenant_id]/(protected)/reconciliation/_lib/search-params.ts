import type { SearchParamValue } from "@publira/utils/search-params";
import {
  searchParamEnum,
  searchParamString,
} from "@publira/utils/search-params";
import { z } from "zod";

import { cursorTokenSchema } from "#lib/cursor-page";
import {
  PAYMENT_RECONCILIATION_FINDING_KINDS,
  PAYMENT_RECONCILIATION_MODES,
} from "#lib/payment-reconciliation";
import type {
  PaymentReconciliationFindingKindValue,
  PaymentReconciliationModeValue,
} from "#lib/payment-reconciliation";
import { buildQueryString } from "#lib/query-string";

interface ParseReconciliationSearchParamsInput {
  findings_token?: SearchParamValue;
  kind?: SearchParamValue;
  mode?: SearchParamValue;
  run?: SearchParamValue;
  token?: SearchParamValue;
}

export interface ReconciliationSearchParams {
  /** The page of the open run's lines. */
  findingsToken: string;
  /** Only the lines of this kind, or `""` for every kind. */
  kind: Exclude<PaymentReconciliationFindingKindValue, "other"> | "";
  mode: PaymentReconciliationModeValue;
  /** The run whose lines the drawer shows, or `""` while it is closed. */
  run: string;
  /** The page of the list of runs. */
  token: string;
}

/**
 * Every value falls back to the screen's default view, so an unusable query
 * string still lists the runs. A `run` that is not a UUID leaves the drawer
 * closed, since no run is addressed by anything else.
 */
const reconciliationSearchParamsSchema = z.object({
  findingsToken: cursorTokenSchema,
  kind: searchParamEnum(PAYMENT_RECONCILIATION_FINDING_KINDS, {
    fallback: "",
  }),
  mode: searchParamEnum(PAYMENT_RECONCILIATION_MODES, { fallback: "" }),
  run: searchParamString({ fallback: "" }).transform((value) =>
    z.guid().safeParse(value).success ? value : ""
  ),
  token: cursorTokenSchema,
});

export const parseReconciliationSearchParams = ({
  findings_token: findingsToken,
  ...input
}: ParseReconciliationSearchParamsInput): ReconciliationSearchParams =>
  reconciliationSearchParamsSchema.parse({ ...input, findingsToken });

/**
 * The query string of the screen on the runs page `token` names, with the
 * drawer open on `run` and its lines narrowed to `kind` and `mode` on the
 * page `findingsToken` names. A run's filters and page belong to that run,
 * so they are dropped with it.
 */
export const reconciliationQuery = ({
  findingsToken,
  kind,
  mode,
  run,
  token,
}: Partial<ReconciliationSearchParams>): string =>
  buildQueryString({
    findings_token: run ? findingsToken : undefined,
    kind: run ? kind : undefined,
    mode: run ? mode : undefined,
    run,
    token,
  }) || "?";
