import { getMessage } from "@publira/i18n";
import Form from "next/form";

import { SEARCH_QUERY_MAX_LENGTH } from "#lib/catalog";
import { getLocale, loadHostMessages, localePath } from "#lib/locale";

/** Same footprint as the rendered control, so the header does not shift. */
export const CatalogSearchFormSkeleton = () => (
  <div
    aria-hidden="true"
    className="flex max-w-64 min-w-0 flex-1 items-center gap-2"
  >
    <span className="h-9 min-w-0 flex-1 animate-pulse rounded-control bg-muted" />
    <span className="h-9 w-14 shrink-0 animate-pulse rounded-control bg-muted" />
  </div>
);

/**
 * The whole control resolves the catalog at once rather than per string: the
 * label and the placeholder are attributes, which cannot stream, and the form's
 * own action needs the locale prefix. The caller wraps this in the
 * `<Suspense>` whose fallback is {@link CatalogSearchFormSkeleton}.
 * Its string `action` is a search GET navigation, not a state-changing Server
 * Action, so the same-origin policy does not apply.
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
  const action = await localePath("/search");

  return (
    <search className="flex max-w-64 min-w-0 flex-1 items-center gap-2">
      <Form
        action={action}
        className="flex min-w-0 flex-1 items-center gap-2"
        key={defaultQuery}
      >
        <label className="sr-only" htmlFor={id}>
          {label}
        </label>
        <input
          autoComplete="off"
          className="h-9 min-w-0 flex-1 rounded-control border border-input bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          defaultValue={defaultQuery}
          id={id}
          maxLength={SEARCH_QUERY_MAX_LENGTH}
          name="q"
          placeholder={label}
          type="search"
        />
        <button
          className="h-9 shrink-0 rounded-control border border-input bg-background px-3 text-sm font-medium text-foreground transition-colors duration-state ease-state hover:bg-muted"
          type="submit"
        >
          {getMessage(messages, "host.nav.search_submit")}
        </button>
      </Form>
    </search>
  );
};
