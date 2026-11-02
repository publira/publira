"use server";

import type * as ActionForm from "@publira/ui-components/action-form";
import { toFieldErrors } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { refresh } from "next/cache";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { requiredTrimmedString } from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import type { AdminMessageAccessor } from "#lib/messages";
import { startPaymentReconciliation } from "#lib/payment-reconciliation";

import { reconciliationPeriodProblem } from "./period";

const PLAIN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

/** A calendar day as `<input type="date">` posts it, and one that exists. */
const isPlainDate = (value: string): boolean => {
  if (!PLAIN_DATE_RE.test(value)) {
    return false;
  }

  try {
    Temporal.PlainDate.from(value, { overflow: "reject" });

    return true;
  } catch {
    return false;
  }
};

const plainDateSchema = (message: string) =>
  requiredTrimmedString(message).refine(isPlainDate, message);

const startReconciliationSchema = (t: AdminMessageAccessor) =>
  z
    .object({
      endDate: plainDateSchema(t("admin.reconciliation.period.end_required")),
      startDate: plainDateSchema(
        t("admin.reconciliation.period.start_required")
      ),
      tenantId: requiredTrimmedString(t("admin.reconciliation.start_failed")),
    })
    .superRefine((value, ctx) => {
      // zod runs this after a field has failed too, and a field that is not a
      // day has already said so.
      if (!(isPlainDate(value.startDate) && isPlainDate(value.endDate))) {
        return;
      }

      switch (reconciliationPeriodProblem(value)) {
        case "reversed": {
          ctx.addIssue({
            code: "custom",
            message: t("admin.reconciliation.period.reversed"),
            path: ["endDate"],
          });
          break;
        }

        case "too_long": {
          ctx.addIssue({
            code: "custom",
            message: t("admin.reconciliation.period.too_long"),
            path: ["endDate"],
          });
          break;
        }

        default: {
          break;
        }
      }
    });

/**
 * Starts a reconciliation of the period the form names. The runs it writes
 * are finished by the worker, and the list behind the form is uncached (see
 * `lib/payment-reconciliation.ts`), so the route is re-rendered to show them
 * waiting rather than a tag dropped. The audit log the start is recorded in
 * is uncached too.
 */
export const startPaymentReconciliationAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const t = await getMessagesFor(locale);

  const parsed = startReconciliationSchema(t).safeParse(
    toFormDataInput(formData, {
      endDate: { kind: "value", name: "end_date" },
      startDate: { kind: "value", name: "start_date" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );

  if (!parsed.success) {
    const fieldErrors = toFieldErrors(parsed.error);

    // Every field sits in one row, so the first thing wrong with it is the
    // one message the form shows.
    return {
      message:
        fieldErrors.startDate ??
        fieldErrors.endDate ??
        fieldErrors.tenantId ??
        t("errors.validation"),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    startPaymentReconciliation(parsed.data, locale)
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  refresh();

  return {
    message: t("admin.reconciliation.started", {
      count: result.reconciliations.length,
    }),
    ok: true,
  };
};
