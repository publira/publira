"use client";

import { cn } from "@publira/utils";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

type TableProps = ComponentPropsWithoutRef<"table">;
type TheadProps = ComponentPropsWithoutRef<"thead">;
type TbodyProps = ComponentPropsWithoutRef<"tbody">;
type TrProps = ComponentPropsWithoutRef<"tr">;
type ThProps = ComponentPropsWithoutRef<"th">;
type TdProps = ComponentPropsWithoutRef<"td">;

/**
 * The table is the page: rows separated by hairlines, on the paper the screen
 * is already on. Nothing wraps it — a card around a table draws a second
 * boundary around the one the rules already describe.
 *
 * `tabular-nums` sits on the table rather than on the cells that hold numbers.
 * A column of figures only lines up if every figure in it is the same width,
 * and which columns those are is decided by the data a screen puts in them,
 * not by the primitive.
 */
export const Table = ({ className, ...props }: TableProps) => (
  <div className="w-full overflow-auto">
    <table
      {...props}
      className={cn("w-full caption-bottom text-sm tabular-nums", className)}
    />
  </div>
);

/** The rule under the header is heavier than the ones between rows. */
export const TableHeader = ({ className, ...props }: TheadProps) => (
  <thead
    {...props}
    className={cn("[&_tr]:border-b-2 [&_tr]:border-border", className)}
  />
);

export const TableBody = ({ className, ...props }: TbodyProps) => (
  <tbody {...props} className={cn("[&_tr:last-child]:border-0", className)} />
);

export const TableRow = ({ className, ...props }: TrProps) => (
  <tr
    {...props}
    className={cn(
      "border-b border-border transition-colors duration-state ease-state hover:bg-muted",
      className
    )}
  />
);

export const TableHead = ({ className, ...props }: ThProps) => (
  <th
    {...props}
    className={cn(
      "h-10 px-3 text-left align-middle font-medium text-muted-foreground",
      className
    )}
  />
);

export const TableCell = ({ className, ...props }: TdProps) => (
  <td {...props} className={cn("px-3 py-3 align-middle", className)} />
);

export interface TableEmptyRowProps {
  colSpan: number;
  /** What the empty table says, in the caller's locale. */
  children: ReactNode;
}

export const TableEmptyRow = ({ children, colSpan }: TableEmptyRowProps) => (
  <TableRow className="hover:bg-transparent">
    <TableCell
      className="py-10 text-center text-sm text-muted-foreground"
      colSpan={colSpan}
    >
      {children}
    </TableCell>
  </TableRow>
);

export interface TableLoadingRowProps {
  colSpan: number;
  rows?: number;
}

export const TableLoadingRow = ({
  colSpan,
  rows = 3,
}: TableLoadingRowProps) => (
  <>
    {Array.from({ length: rows }, (_, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: static loading placeholder
      <TableRow key={i} className="hover:bg-transparent">
        <TableCell className="py-3" colSpan={colSpan}>
          <div
            aria-hidden
            className="h-5 rounded-control bg-muted motion-safe:animate-pulse"
          />
        </TableCell>
      </TableRow>
    ))}
  </>
);
