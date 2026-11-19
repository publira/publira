import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { startPaymentReconciliationAction } from "../_lib/actions";
import type { ReconciliationPeriod } from "../_lib/period";

interface ReconcileFormProps {
  /** The period the fields start at, and return to once a run is started. */
  defaultPeriod: ReconciliationPeriod;
  tenantId: string;
  /** The IANA zone the tenant's days are counted in. */
  timeZone: string;
  /** The tenant's today, the last day a period may end on. */
  today: string;
}

/**
 * Chooses a period and starts a reconciliation of it against every source the
 * tenant has ready. The fields are closed while the start is in flight, and
 * the runs it writes appear in the list below.
 */
export const ReconcileForm = ({
  defaultPeriod,
  tenantId,
  timeZone,
  today,
}: ReconcileFormProps) => (
  <section className="grid gap-3">
    <p className="max-w-3xl text-sm text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
        <Message
          message="admin.reconciliation.period.description"
          values={{ time_zone: timeZone }}
        />
      </Suspense>
    </p>
    <ActionForm.Root
      action={startPaymentReconciliationAction}
      className="grid gap-3"
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <ActionForm.Fieldset className="flex flex-wrap items-end gap-4">
        <Field.Root className="w-44">
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.reconciliation.period.from" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              defaultValue={defaultPeriod.startDate}
              max={today}
              name="start_date"
              required
              type="date"
            />
          </Field.Content>
        </Field.Root>
        <Field.Root className="w-44">
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.reconciliation.period.to" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              defaultValue={defaultPeriod.endDate}
              max={today}
              name="end_date"
              required
              type="date"
            />
          </Field.Content>
        </Field.Root>
        <ActionForm.Submit>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <ActionForm.Idle>
              <Message message="admin.reconciliation.reconcile" />
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Message message="admin.reconciliation.reconciling" />
            </ActionForm.Pending>
          </Suspense>
        </ActionForm.Submit>
      </ActionForm.Fieldset>
    </ActionForm.Root>
  </section>
);
