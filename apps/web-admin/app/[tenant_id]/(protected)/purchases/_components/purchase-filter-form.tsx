import type { Locale } from "@publira/i18n";
import { Button, LinkButton } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getMessagesFor } from "#lib/messages";

import type { PurchaseFilters } from "../_lib/search-params";

interface PurchaseFilterFormProps {
  filters: PurchaseFilters;
  locale: Locale;
  timeZone: string;
}

/**
 * Narrows the list through the query string. The open drawer and the page are
 * not fields, so applying a filter closes the one and starts from the first
 * of the other, as the API asks of a changed filter.
 */
export const PurchaseFilterForm = async ({
  filters,
  locale,
  timeZone,
}: PurchaseFilterFormProps) => {
  const t = await getMessagesFor(locale);

  return (
    <section className="grid gap-3">
      <p className="max-w-3xl text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
          <Message
            message="admin.purchases.filter.description"
            values={{ time_zone: timeZone }}
          />
        </Suspense>
      </p>
      <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.purchases.filter.email" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              defaultValue={filters.email}
              name="email"
              placeholder={t("admin.purchases.filter.email_placeholder")}
              type="email"
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.purchases.filter.series" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              defaultValue={filters.series}
              name="series"
              placeholder={t("admin.purchases.filter.series_placeholder")}
              type="text"
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.purchases.filter.episode" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              defaultValue={filters.episode}
              name="episode"
              placeholder={t("admin.purchases.filter.episode_placeholder")}
              type="text"
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.purchases.filter.from" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input defaultValue={filters.from} name="from" type="date" />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.purchases.filter.to" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input defaultValue={filters.to} name="to" type="date" />
          </FieldContent>
        </Field>

        <div className="flex items-end gap-2">
          <Button type="submit">
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.purchases.filter.apply" />
            </Suspense>
          </Button>
          <LinkButton href="/purchases" variant="outline">
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.purchases.filter.reset" />
            </Suspense>
          </LinkButton>
        </div>
      </form>
    </section>
  );
};
