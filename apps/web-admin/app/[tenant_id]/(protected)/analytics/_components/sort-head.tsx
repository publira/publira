import { ChevronDownIcon, ChevronUpIcon } from "@publira/icons";
import * as Table from "@publira/ui-components/table";
import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import type { SortOrder } from "../_lib/sort";

type SortHeadProps = Omit<
  ComponentPropsWithoutRef<"th">,
  "aria-sort" | "children"
> & {
  /** The column's label. */
  children: ReactNode;
  /** The URL the table is sorted by this column at, in the order a click picks. */
  href: string;
  /** The order the table is sorted by this column in, or `null` when it is not. */
  sorted: SortOrder | null;
};

const ariaSort = {
  asc: "ascending",
  desc: "descending",
} as const;

/**
 * A column heading that sorts the table by its column. The heading is a link,
 * so the sort is in the URL a reader shares and survives a reload, and the
 * current one is `aria-sort` on the heading as well as the arrow beside it.
 */
export const SortHead = ({
  children,
  href,
  sorted,
  ...props
}: SortHeadProps) => (
  <Table.Head {...props} aria-sort={sorted ? ariaSort[sorted] : "none"}>
    <Link
      className="inline-flex items-center gap-1 hover:text-foreground"
      href={href}
      scroll={false}
    >
      {children}
      {sorted === "asc" ? (
        <ChevronUpIcon aria-hidden="true" className="size-3.5" />
      ) : null}
      {sorted === "desc" ? (
        <ChevronDownIcon aria-hidden="true" className="size-3.5" />
      ) : null}
    </Link>
  </Table.Head>
);
