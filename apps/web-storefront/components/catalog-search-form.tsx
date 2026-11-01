import { SearchIcon } from "@publira/icons";
import { Button } from "@publira/ui-components/button";
import { Skeleton } from "@publira/ui-components/skeleton";
import { cn } from "@publira/utils";
import Form from "next/form";

import { listPublishedGenres, SEARCH_QUERY_MAX_LENGTH } from "#lib/catalog";
import { getLocale, localePath } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { UNNARROWED_SERIES_SEARCH } from "#lib/series-filters";
import type { SeriesSearchFilters } from "#lib/series-filters";
import { getTenantId } from "#lib/tenant-id";

const CONTROL_LABEL = cn("text-xs font-medium text-muted-foreground");

const CONTROL = cn(
  "h-9 w-full min-w-0 rounded-control border border-input bg-card px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:h-11"
);

/** Where the form is drawn, which decides the shape of its keyword row. */
type CatalogSearchFormVariant = "dialog" | "page";

/** Same footprint as the rendered form, so what is below it does not shift. */
export const CatalogSearchFormSkeleton = ({
  variant = "page",
}: {
  variant?: CatalogSearchFormVariant;
}) =>
  variant === "dialog" ? (
    <div aria-hidden="true" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border pr-14 pl-4">
        <Skeleton className="size-5 shrink-0 rounded-control" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="grid flex-1 content-start gap-4 p-4">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    </div>
  ) : (
    <div aria-hidden="true" className="@container grid w-full gap-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 min-w-0 flex-1 pointer-coarse:h-11" />
        <Skeleton className="h-9 w-20 shrink-0 pointer-coarse:h-11" />
      </div>
      <div className="grid gap-4 @md:grid-cols-2 @3xl:grid-cols-4">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    </div>
  );

/**
 * The catalog search: the keyword, and the sort and filters of the series list
 * written under the series list's own keys, as one `GET` form whose fields are
 * the query string of `/search`. A narrowed result is therefore a plain URL a
 * reader can share and reload.
 *
 * The whole form resolves the accessor at once rather than per string: the
 * labels, the option text, and the placeholder belong to controls that submit
 * as one unit, and the form's own action needs the locale prefix. The caller
 * wraps this in the `<Suspense>` whose fallback is
 * {@link CatalogSearchFormSkeleton}. Its string `action` is a search
 * navigation, not a state-changing Server Action, so the same-origin policy
 * does not apply.
 *
 * The filters are a fieldset of their own because only the series group has a
 * genre, a serialization status, or a price; its legend says so, and the
 * search screen answers a narrowed search with that group alone. A tenant that
 * curates no genre, and a genre read that could not answer, leave the other
 * three controls rather than holding the search behind one dropdown.
 *
 * No `token` field, which is what makes a new submission start at page one: a
 * cursor names a row of the result it was built for, and the server rejects
 * one sent with a different keyword, sort, or filter (`proto/README.md`).
 *
 * `variant` is where the form is drawn. On the search screen the keyword is a
 * bordered field with its button beside it, above the filters. In the search
 * dialog the keyword row is the dialog's own top edge — borderless, the full
 * width, ruled off from the filters below — and the button sits at the foot,
 * so the filters are what scrolls when the dialog fills a phone. The end of
 * that row is left clear for the dialog's close button, which lies over it.
 */
export const CatalogSearchForm = async ({
  defaultFilters = UNNARROWED_SERIES_SEARCH,
  defaultQuery = "",
  id,
  variant = "page",
}: {
  defaultFilters?: SeriesSearchFilters;
  defaultQuery?: string;
  /** Prefix of every control's id, unique to the place the form renders in. */
  id: string;
  variant?: CatalogSearchFormVariant;
}) => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const [t, action, genres] = await Promise.all([
    getMessagesFor(locale),
    localePath("/search"),
    listPublishedGenres(tenantId, locale),
  ]);

  const label = t("storefront.nav.search_label");
  const genreOptions = genres.ok ? genres.value : [];

  const filters = (
    <fieldset
      className={cn(
        "grid gap-4 @md:grid-cols-2",
        variant === "page" && "@3xl:grid-cols-4"
      )}
    >
      <legend className="mb-3 text-sm font-medium text-foreground">
        {t("storefront.search.filters_legend")}
      </legend>

      {genreOptions.length > 0 && (
        <div className="grid gap-1.5">
          <label className={CONTROL_LABEL} htmlFor={`${id}-genre`}>
            {t("storefront.series.filter_genre")}
          </label>
          <select
            className={CONTROL}
            defaultValue={defaultFilters.genre}
            id={`${id}-genre`}
            name="genre"
          >
            <option value="">{t("storefront.series.filter_genre_all")}</option>
            {genreOptions.map((genre) => (
              <option
                key={genre.publicId}
                lang={genre.locale}
                value={genre.publicId}
              >
                {genre.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid gap-1.5">
        <label className={CONTROL_LABEL} htmlFor={`${id}-order`}>
          {t("storefront.series.filter_order")}
        </label>
        <select
          className={CONTROL}
          defaultValue={defaultFilters.order}
          id={`${id}-order`}
          name="order"
        >
          <option value="">{t("storefront.search.order_relevance")}</option>
          <option value="newest">{t("storefront.series.order_newest")}</option>
          <option value="updated">
            {t("storefront.series.order_updated")}
          </option>
          <option value="title">{t("storefront.series.order_title")}</option>
        </select>
      </div>

      <div className="grid gap-1.5">
        <label className={CONTROL_LABEL} htmlFor={`${id}-status`}>
          {t("storefront.series.filter_status")}
        </label>
        <select
          className={CONTROL}
          defaultValue={defaultFilters.status}
          id={`${id}-status`}
          name="status"
        >
          <option value="">{t("storefront.series.filter_status_all")}</option>
          <option value="ongoing">
            {t("storefront.series.status_ongoing")}
          </option>
          <option value="completed">
            {t("storefront.series.status_completed")}
          </option>
          <option value="hiatus">{t("storefront.series.status_hiatus")}</option>
        </select>
      </div>

      <div className="flex items-end">
        <label
          className="flex min-h-9 items-center gap-2 text-sm text-foreground pointer-coarse:min-h-11"
          htmlFor={`${id}-free`}
        >
          <input
            className="size-4 rounded-control border-input accent-primary"
            defaultChecked={defaultFilters.free}
            id={`${id}-free`}
            name="free"
            type="checkbox"
            value="1"
          />
          {t("storefront.series.filter_free")}
        </label>
      </div>
    </fieldset>
  );

  const submit = (
    // Outlined rather than filled: the one filled control a storefront screen
    // is allowed is the Shu the reading action takes.
    <Button className="shrink-0" type="submit" variant="outline">
      {t("storefront.nav.search_submit")}
    </Button>
  );

  // The controls are uncontrolled, so a navigation that changes the query has
  // to bring new elements with it rather than new default values.
  const formKey = JSON.stringify([defaultQuery, defaultFilters]);

  if (variant === "dialog") {
    return (
      <search className="@container flex min-h-0 flex-1 flex-col">
        <Form
          action={action}
          className="flex min-h-0 flex-1 flex-col"
          key={formKey}
        >
          <div className="relative shrink-0 border-b border-border">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground"
            />
            <label className="sr-only" htmlFor={`${id}-keyword`}>
              {label}
            </label>
            <input
              autoComplete="off"
              className="h-14 w-full min-w-0 bg-transparent pr-14 pl-12 text-base text-foreground placeholder:text-muted-foreground focus-visible:shadow-[inset_0_-2px_0_0_var(--color-ring)] focus-visible:outline-none"
              defaultValue={defaultQuery}
              enterKeyHint="search"
              id={`${id}-keyword`}
              maxLength={SEARCH_QUERY_MAX_LENGTH}
              name="q"
              placeholder={label}
              type="search"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{filters}</div>
          <div className="flex shrink-0 justify-end border-t border-border px-4 py-3">
            {submit}
          </div>
        </Form>
      </search>
    );
  }

  return (
    <search className="@container w-full">
      <Form action={action} className="grid gap-4" key={formKey}>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`${id}-keyword`}>
            {label}
          </label>
          <input
            autoComplete="off"
            className={cn(CONTROL, "flex-1 placeholder:text-muted-foreground")}
            defaultValue={defaultQuery}
            enterKeyHint="search"
            id={`${id}-keyword`}
            maxLength={SEARCH_QUERY_MAX_LENGTH}
            name="q"
            placeholder={label}
            type="search"
          />
          {submit}
        </div>

        {filters}
      </Form>
    </search>
  );
};
