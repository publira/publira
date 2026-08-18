import Form from "next/form";

import { SEARCH_QUERY_MAX_LENGTH } from "#lib/catalog";

export const CatalogSearchForm = ({
  defaultQuery = "",
  id = "catalog-search",
}: {
  defaultQuery?: string;
  id?: string;
}) => (
  <search className="flex max-w-64 min-w-0 flex-1 items-center gap-2">
    <Form
      action="/search"
      className="flex min-w-0 flex-1 items-center gap-2"
      key={defaultQuery}
    >
      <label className="sr-only" htmlFor={id}>
        作品を検索
      </label>
      <input
        autoComplete="off"
        className="h-9 min-w-0 flex-1 rounded-md border border-border/70 bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        defaultValue={defaultQuery}
        id={id}
        maxLength={SEARCH_QUERY_MAX_LENGTH}
        name="q"
        placeholder="作品を検索"
        type="search"
      />
      <button
        className="h-9 shrink-0 rounded-md bg-secondary px-3 text-sm font-medium text-secondary-foreground transition hover:opacity-90"
        type="submit"
      >
        検索
      </button>
    </Form>
  </search>
);
