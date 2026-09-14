import type { Locale } from "@publira/i18n";
import { Button, LinkButton } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getMessagesFor } from "#lib/messages";

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
const statusOptions = async (
  locale: Locale
): Promise<{ label: string; value: string }[]> => {
  const t = await getMessagesFor(locale);

  return [
    {
      label: t("admin.comments.filter.status_all"),
      value: "",
    },
    ...(await Promise.all(
      COMMENT_STATUSES.map(async (status) => ({
        label: await commentStatusLabel(status, locale),
        value: status,
      }))
    )),
  ];
};

export const CommentFilterForm = async ({
  filters,
  locale,
  timeZone,
}: CommentFilterFormProps) => {
  const t = await getMessagesFor(locale);

  return (
    <section className="grid gap-3">
      <p className="max-w-3xl text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
          <Message
            message="admin.comments.filter.description"
            values={{
              time_zone: timeZone,
            }}
          />
        </Suspense>
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
          options={await statusOptions(locale)}
        />

        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.comments.filter.series" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              defaultValue={filters.series}
              name="series"
              placeholder={t("admin.comments.filter.series_placeholder")}
              type="text"
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.comments.filter.episode" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              defaultValue={filters.episode}
              name="episode"
              placeholder={t("admin.comments.filter.episode_placeholder")}
              type="text"
            />
          </FieldContent>
        </Field>

        <div className="flex items-end gap-2">
          <Button type="submit">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.comments.filter.apply" />
            </Suspense>
          </Button>
          <LinkButton href="/comments" variant="outline">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.comments.filter.reset" />
            </Suspense>
          </LinkButton>
        </div>
      </form>
    </section>
  );
};
