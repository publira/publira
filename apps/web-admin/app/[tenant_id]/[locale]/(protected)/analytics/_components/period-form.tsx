import { Button, LinkButton } from "@publira/ui-components/button";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { Message } from "#components/message";

import type { AnalyticsPeriod } from "../_lib/period";

interface PeriodFormProps {
  /**
   * The hidden fields that carry the rest of the screen's state — the
   * breakdown, the sort — so choosing a period keeps them.
   */
  children?: ReactNode;
  period: AnalyticsPeriod;
  /** The screen's own path: Reset is a link to it, never a submit button. */
  resetHref: string;
  /** The IANA zone the tenant's days are counted in. */
  timeZone: string;
}

/**
 * The period an analytics screen reports, as a GET form whose fields are the
 * URL's `from` and `to`. Both hold the period being shown, the default
 * included, so an operator moves it from the dates on screen.
 */
export const PeriodForm = ({
  children,
  period,
  resetHref,
  timeZone,
}: PeriodFormProps) => (
  <section className="grid gap-3">
    <p className="max-w-3xl text-sm text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
        <Message
          message="admin.analytics.period.description"
          values={{ time_zone: timeZone }}
        />
      </Suspense>
    </p>
    <form className="flex flex-wrap items-end gap-4">
      <Field.Root className="w-44">
        <Field.Label>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="admin.analytics.period.from" />
          </Suspense>
        </Field.Label>
        <Field.Content>
          <Input defaultValue={period.start} name="from" type="date" />
        </Field.Content>
      </Field.Root>
      <Field.Root className="w-44">
        <Field.Label>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="admin.analytics.period.to" />
          </Suspense>
        </Field.Label>
        <Field.Content>
          <Input defaultValue={period.end} name="to" type="date" />
        </Field.Content>
      </Field.Root>
      {children}
      <div className="flex gap-2">
        <Button type="submit">
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="admin.analytics.period.apply" />
          </Suspense>
        </Button>
        <LinkButton href={resetHref} variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="admin.analytics.period.reset" />
          </Suspense>
        </LinkButton>
      </div>
    </form>
    {period.ok ? null : (
      <FormMessage variant="destructive">
        <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
          {period.reason === "reversed" ? (
            <Message message="admin.analytics.period.reversed" />
          ) : (
            <Message message="admin.analytics.period.too_long" />
          )}
        </Suspense>
      </FormMessage>
    )}
  </section>
);
