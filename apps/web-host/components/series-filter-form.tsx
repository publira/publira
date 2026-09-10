import { getMessage } from "@publira/i18n";
import { Button, LinkButton } from "@publira/ui-components/button";
import { cn } from "@publira/utils";
import Form from "next/form";

import type { PublishedGenreItem } from "#lib/catalog";
import { getLocale, loadHostMessages, localePath } from "#lib/locale";
import { seriesListQueryHref } from "#lib/series-filters";
import type { SeriesListQuery } from "#lib/series-filters";

const CONTROL_LABEL = cn("text-xs font-medium text-muted-foreground");

const CONTROL = cn(
  "h-9 w-full rounded-control border border-input bg-card px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
);

/** Same footprint as the rendered row, so the list below it does not shift. */
export const SeriesFilterFormSkeleton = () => (
  <div
    aria-hidden="true"
    className="grid gap-4 rounded-surface border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
  >
    <span className="h-14 animate-pulse rounded-control bg-muted" />
    <span className="h-14 animate-pulse rounded-control bg-muted" />
    <span className="h-14 animate-pulse rounded-control bg-muted" />
    <span className="h-14 animate-pulse rounded-control bg-muted" />
  </div>
);

/**
 * The sort and the filters of a published series list, as a `GET` form whose
 * fields are the query string of the screen it submits to.
 *
 * Every option label, every `<label>`, and the form's own accessible name is an
 * attribute or a text node of a control that has to submit as one unit, so the
 * whole row resolves the catalog at once behind the `<Suspense>` whose fallback
 * is {@link SeriesFilterFormSkeleton} rather than streaming string by string.
 *
 * The controls are native `<select>` and `<input>` elements: this row is the
 * only way to narrow the catalog, and a reader whose scripts have not run yet
 * can still use it. Its `action` is a search navigation, not a state-changing
 * Server Action, so the same-origin policy does not apply.
 *
 * No `token` field, which is what makes changing a filter start at page one:
 * a cursor names a row in the list it was built for, and the server rejects one
 * sent with a different order or filter (`proto/README.md`).
 *
 * Reset is a link rather than a submit button, because a `GET` form appends its
 * own fields to whatever path it submits to and would hand back the filters it
 * was meant to drop.
 */
export const SeriesFilterForm = async ({
  basePath,
  genres,
  query,
}: {
  /** The screen's own path, without a locale prefix, e.g. `/series`. */
  basePath: string;
  /** Empty on a screen whose genre is already fixed by its own URL. */
  genres: readonly PublishedGenreItem[];
  query: SeriesListQuery;
}) => {
  const locale = await getLocale();
  const [messages, action] = await Promise.all([
    loadHostMessages(locale),
    localePath(basePath),
  ]);

  return (
    <Form
      action={action}
      aria-label={getMessage(messages, "host.series.filter_aria")}
      className="grid gap-4 rounded-surface border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
      // The controls are uncontrolled, so a navigation that changes the query
      // has to bring new elements with it rather than new default values.
      key={seriesListQueryHref(basePath, query)}
    >
      {genres.length > 0 && (
        <div className="grid gap-1.5">
          <label className={CONTROL_LABEL} htmlFor="series-filter-genre">
            {getMessage(messages, "host.series.filter_genre")}
          </label>
          <select
            className={CONTROL}
            defaultValue={query.genre ?? ""}
            id="series-filter-genre"
            name="genre"
          >
            <option value="">
              {getMessage(messages, "host.series.filter_genre_all")}
            </option>
            {genres.map((genre) => (
              <option key={genre.publicId} value={genre.publicId}>
                {genre.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid gap-1.5">
        <label className={CONTROL_LABEL} htmlFor="series-filter-order">
          {getMessage(messages, "host.series.filter_order")}
        </label>
        <select
          className={CONTROL}
          defaultValue={query.order}
          id="series-filter-order"
          name="order"
        >
          <option value="newest">
            {getMessage(messages, "host.series.order_newest")}
          </option>
          <option value="updated">
            {getMessage(messages, "host.series.order_updated")}
          </option>
          <option value="title">
            {getMessage(messages, "host.series.order_title")}
          </option>
        </select>
      </div>

      <div className="grid gap-1.5">
        <label className={CONTROL_LABEL} htmlFor="series-filter-status">
          {getMessage(messages, "host.series.filter_status")}
        </label>
        <select
          className={CONTROL}
          defaultValue={query.status}
          id="series-filter-status"
          name="status"
        >
          <option value="">
            {getMessage(messages, "host.series.filter_status_all")}
          </option>
          <option value="ongoing">
            {getMessage(messages, "host.series.status_ongoing")}
          </option>
          <option value="completed">
            {getMessage(messages, "host.series.status_completed")}
          </option>
          <option value="hiatus">
            {getMessage(messages, "host.series.status_hiatus")}
          </option>
        </select>
      </div>

      <div className="grid gap-2 sm:col-span-2 lg:col-span-1 lg:content-end">
        <label
          className="flex items-center gap-2 text-sm text-foreground"
          htmlFor="series-filter-free"
        >
          <input
            className="size-4 rounded-control border-input accent-primary"
            defaultChecked={query.free}
            id="series-filter-free"
            name="free"
            type="checkbox"
            value="1"
          />
          {getMessage(messages, "host.series.filter_free")}
        </label>
        <div className="flex items-center gap-2">
          {/* Outlined rather than filled: the one filled control a storefront
              screen is allowed is the Shu the reading action takes, and the
              band above already carries the site's own. */}
          <Button type="submit" variant="outline">
            {getMessage(messages, "host.series.filter_apply")}
          </Button>
          <LinkButton href={action} variant="ghost">
            {getMessage(messages, "host.series.filter_reset")}
          </LinkButton>
        </div>
      </div>
    </Form>
  );
};
