import type { Locale } from "@publira/i18n";
import { Button, LinkButton } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { Select } from "@publira/ui-components/select";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getMessagesFor } from "#lib/messages";

import type { ReaderFilters } from "../_lib/search-params";
import { READER_STATUSES } from "../reader-types";
import { readerStatusLabel } from "./reader-status-label";

interface ReaderFilterFormProps {
  filters: ReaderFilters;
  locale: Locale;
}

/** The status options, with "every state" first as the default view. */
const statusOptions = async (
  locale: Locale
): Promise<{ label: string; value: string }[]> => {
  const t = await getMessagesFor(locale);

  return [
    { label: t("admin.readers.filter.status_all"), value: "" },
    ...(await Promise.all(
      READER_STATUSES.map(async (status) => ({
        label: await readerStatusLabel(status, locale),
        value: status,
      }))
    )),
  ];
};

export const ReaderFilterForm = async ({
  filters,
  locale,
}: ReaderFilterFormProps) => {
  const t = await getMessagesFor(locale);

  return (
    <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Field className="md:col-span-2">
        <FieldLabel>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.readers.filter.query" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Input
            defaultValue={filters.query}
            name="q"
            placeholder={t("admin.readers.filter.query_placeholder")}
            type="search"
          />
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.readers.filter.status" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Select
            defaultValue={filters.status}
            items={await statusOptions(locale)}
            name="status"
          />
        </FieldContent>
      </Field>

      <div className="flex items-end gap-2">
        <Button type="submit">
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.readers.filter.apply" />
          </Suspense>
        </Button>
        <LinkButton href="/readers" variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.readers.filter.reset" />
          </Suspense>
        </LinkButton>
      </div>
    </form>
  );
};
