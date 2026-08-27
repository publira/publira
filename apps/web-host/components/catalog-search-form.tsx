import { getMessage } from "@publira/i18n";
import Form from "next/form";

import { SEARCH_QUERY_MAX_LENGTH } from "#lib/catalog";
import { getLocale, loadHostMessages } from "#lib/locale";
import { withLocalePrefix } from "#lib/locale-path";

/** Same footprint as the rendered control, so the header does not shift. */
export const CatalogSearchFormSkeleton = () => (
  <div
    aria-hidden="true"
    className="flex max-w-64 min-w-0 flex-1 items-center gap-2"
  >
    <span className="h-9 min-w-0 flex-1 animate-pulse rounded-md bg-muted" />
    <span className="h-9 w-14 shrink-0 animate-pulse rounded-md bg-muted" />
  </div>
);

/**
 * The whole control resolves the catalog at once rather than per string: the
 * label and the placeholder are attributes, which cannot stream, and the form's
 * own action needs the locale prefix. The caller wraps this in the
 * `<Suspense>` whose fallback is {@link CatalogSearchFormSkeleton}.
 */
export const CatalogSearchForm = async ({
  defaultQuery = "",
  id = "catalog-search",
}: {
  defaultQuery?: string;
  id?: string;
}) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);
  const label = getMessage(messages, "host.nav.search_label");

  return (
    <search className="flex max-w-64 min-w-0 flex-1 items-center gap-2">
      <Form
        action={withLocalePrefix(locale, "/search")}
        className="flex min-w-0 flex-1 items-center gap-2"
        key={defaultQuery}
      >
        <label className="sr-only" htmlFor={id}>
          {label}
        </label>
        <input
          autoComplete="off"
          className="h-9 min-w-0 flex-1 rounded-md border border-border/70 bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          defaultValue={defaultQuery}
          id={id}
          maxLength={SEARCH_QUERY_MAX_LENGTH}
          name="q"
          placeholder={label}
          type="search"
        />
        <button
          className="h-9 shrink-0 rounded-md bg-secondary px-3 text-sm font-medium text-secondary-foreground transition hover:opacity-90"
          type="submit"
        >
          {getMessage(messages, "host.nav.search_submit")}
        </button>
      </Form>
    </search>
  );
};
