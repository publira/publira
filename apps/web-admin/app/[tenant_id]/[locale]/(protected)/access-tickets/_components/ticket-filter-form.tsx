import type { Locale } from "@publira/i18n";
import { Button, LinkButton } from "@publira/ui-components/button";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { Select } from "@publira/ui-components/select";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getMessagesFor } from "#lib/messages";

import type { AccessTicketFilters } from "../_lib/search-params";

interface TicketFilterFormProps {
  filters: AccessTicketFilters;
  locale: Locale;
}

export const TicketFilterForm = async ({
  filters,
  locale,
}: TicketFilterFormProps) => {
  const t = await getMessagesFor(locale);

  return (
    <section className="grid gap-3">
      <p className="max-w-3xl text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
          <Message message="admin.access_tickets.filter.description" />
        </Suspense>
      </p>
      <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field.Root>
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.access_tickets.filter.user" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              defaultValue={filters.user}
              name="user"
              placeholder={t("admin.access_tickets.filter.user_placeholder")}
              type="text"
            />
          </Field.Content>
        </Field.Root>

        <Field.Root>
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.access_tickets.filter.episode" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              defaultValue={filters.episode}
              name="episode"
              placeholder={t("admin.access_tickets.filter.episode_placeholder")}
              type="text"
            />
          </Field.Content>
        </Field.Root>

        <Field.Root>
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.access_tickets.filter.status" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Select
              defaultValue={filters.active ? "1" : ""}
              items={[
                {
                  label: t("admin.access_tickets.filter.status_all"),
                  value: "",
                },
                {
                  label: t("admin.access_tickets.filter.status_active_only"),
                  value: "1",
                },
              ]}
              name="active"
            />
          </Field.Content>
        </Field.Root>

        <div className="flex items-end gap-2">
          <Button type="submit">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.access_tickets.filter.apply" />
            </Suspense>
          </Button>
          <LinkButton href="/access-tickets" variant="outline">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.access_tickets.filter.reset" />
            </Suspense>
          </LinkButton>
        </div>
      </form>
    </section>
  );
};
