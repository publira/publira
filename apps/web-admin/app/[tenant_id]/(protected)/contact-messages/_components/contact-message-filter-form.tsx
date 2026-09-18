import type { Locale } from "@publira/i18n";
import { Button, LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getMessagesFor } from "#lib/messages";

import type { ContactMessageFilters } from "../_lib/search-params";
import { CONTACT_MESSAGE_STATUSES } from "../contact-message-types";
import { contactMessageStatusLabel } from "./contact-message-status-label";
import { ContactMessageStatusSelect } from "./contact-message-status-select";

interface ContactMessageFilterFormProps {
  filters: ContactMessageFilters;
  locale: Locale;
}

/** The status options, with "both states" first as the default view. */
const statusOptions = async (
  locale: Locale
): Promise<{ label: string; value: string }[]> => {
  const t = await getMessagesFor(locale);

  return [
    { label: t("admin.contact_messages.filter.status_all"), value: "" },
    ...(await Promise.all(
      CONTACT_MESSAGE_STATUSES.map(async (status) => ({
        label: await contactMessageStatusLabel(status, locale),
        value: status,
      }))
    )),
  ];
};

export const ContactMessageFilterForm = async ({
  filters,
  locale,
}: ContactMessageFilterFormProps) => (
  <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
    <ContactMessageStatusSelect
      defaultValue={filters.status}
      options={await statusOptions(locale)}
    />

    <div className="flex items-end gap-2">
      <Button type="submit">
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="admin.contact_messages.filter.apply" />
        </Suspense>
      </Button>
      <LinkButton href="/contact-messages" variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="admin.contact_messages.filter.reset" />
        </Suspense>
      </LinkButton>
    </div>
  </form>
);
