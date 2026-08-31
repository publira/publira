import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";

import type { AccessTicketFilters } from "../_lib/search-params";
import { TicketFilterActiveSelect } from "./ticket-filter-active-select";

interface TicketFilterFormProps {
  filters: AccessTicketFilters;
  locale: Locale;
}

export const TicketFilterForm = ({
  filters,
  locale,
}: TicketFilterFormProps) => {
  const messages = sharedCatalog(locale);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {getMessage(messages, "admin.access_tickets.filter.title")}
        </CardTitle>
        <CardDescription>
          {getMessage(messages, "admin.access_tickets.filter.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field>
            <FieldLabel>
              {getMessage(messages, "admin.access_tickets.filter.user")}
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={filters.user}
                name="user"
                placeholder={getMessage(
                  messages,
                  "admin.access_tickets.filter.user_placeholder"
                )}
                type="text"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>
              {getMessage(messages, "admin.access_tickets.filter.episode")}
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={filters.episode}
                name="episode"
                placeholder={getMessage(
                  messages,
                  "admin.access_tickets.filter.episode_placeholder"
                )}
                type="text"
              />
            </FieldContent>
          </Field>

          <TicketFilterActiveSelect defaultValue={filters.active ? "1" : ""} />

          <div className="flex items-end gap-2">
            <Button type="submit">
              {getMessage(messages, "admin.access_tickets.filter.apply")}
            </Button>
            <Button formAction="?" type="submit" variant="outline">
              {getMessage(messages, "admin.access_tickets.filter.reset")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
