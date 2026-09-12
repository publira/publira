import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { Button, LinkButton } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";

import type { CommentFilters } from "../_lib/search-params";
import { COMMENT_STATUSES } from "../comment-types";
import { commentStatusLabel } from "./comment-status-label";
import { CommentStatusSelect } from "./comment-status-select";

interface CommentFilterFormProps {
  filters: CommentFilters;
  locale: Locale;
  timeZone: string;
}

/**
 * The status options, with the empty value first.
 *
 * "Every state" is the default rather than one queue, because a comment is
 * often judged next to its neighbours: an operator who wants only the approval
 * queue picks it, and the link from the navigation badge already does.
 */
const statusOptions = (locale: Locale): { label: string; value: string }[] => {
  const messages = sharedCatalog(locale);

  return [
    {
      label: getMessage(messages, "admin.comments.filter.status_all"),
      value: "",
    },
    ...COMMENT_STATUSES.map((status) => ({
      label: commentStatusLabel(status, messages),
      value: status,
    })),
  ];
};

export const CommentFilterForm = ({
  filters,
  locale,
  timeZone,
}: CommentFilterFormProps) => {
  const messages = sharedCatalog(locale);

  return (
    <section className="grid gap-3">
      <p className="max-w-3xl text-sm text-muted-foreground">
        {getMessage(messages, "admin.comments.filter.description", {
          time_zone: timeZone,
        })}
      </p>
      <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {/*
          A GET form replaces the whole query of the URL it submits to with
          its own fields, and the report queue above keeps its state in that
          same query. Its two parameters ride along as hidden fields so
          narrowing the comment list does not send the queue back to its
          first page.
        */}
        <input
          name="report_status"
          type="hidden"
          value={filters.reportStatus}
        />
        <input name="report_token" type="hidden" value={filters.reportToken} />

        <CommentStatusSelect
          defaultValue={filters.status}
          options={statusOptions(locale)}
        />

        <Field>
          <FieldLabel>
            {getMessage(messages, "admin.comments.filter.series")}
          </FieldLabel>
          <FieldContent>
            <Input
              defaultValue={filters.series}
              name="series"
              placeholder={getMessage(
                messages,
                "admin.comments.filter.series_placeholder"
              )}
              type="text"
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel>
            {getMessage(messages, "admin.comments.filter.episode")}
          </FieldLabel>
          <FieldContent>
            <Input
              defaultValue={filters.episode}
              name="episode"
              placeholder={getMessage(
                messages,
                "admin.comments.filter.episode_placeholder"
              )}
              type="text"
            />
          </FieldContent>
        </Field>

        <div className="flex items-end gap-2">
          <Button type="submit">
            {getMessage(messages, "admin.comments.filter.apply")}
          </Button>
          <LinkButton href="/comments" variant="outline">
            {getMessage(messages, "admin.comments.filter.reset")}
          </LinkButton>
        </div>
      </form>
    </section>
  );
};
