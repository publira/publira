/**
 * How a result group is being shown.
 *
 * `overview` is the shared screen, where all three groups answer the same
 * keyword side by side: each shows its first few rows and a link into its own
 * view. `page` is that view — one group, one cursor page, with the pagination
 * under it. Nothing pages in the overview, so the two are the only shapes a
 * group takes.
 */
export type SearchGroupView = "overview" | "page";
