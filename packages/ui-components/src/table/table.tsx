"use client";

import { cn } from "@publira/utils";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

type TableProps = ComponentPropsWithoutRef<"table">;
type TheadProps = ComponentPropsWithoutRef<"thead">;
type TbodyProps = ComponentPropsWithoutRef<"tbody">;
type TrProps = ComponentPropsWithoutRef<"tr">;
type ThProps = ComponentPropsWithoutRef<"th">;
type TdProps = ComponentPropsWithoutRef<"td">;

export const Table = ({ className, ...props }: TableProps) => (
  <div className="w-full overflow-auto">
    <table
      {...props}
      className={cn("w-full caption-bottom text-sm", className)}
    />
  </div>
);

export const TableHeader = ({ className, ...props }: TheadProps) => (
  <thead
    {...props}
    className={cn("[&_tr]:border-b [&_tr]:border-border", className)}
  />
);

export const TableBody = ({ className, ...props }: TbodyProps) => (
  <tbody {...props} className={cn("[&_tr:last-child]:border-0", className)} />
);

export const TableRow = ({ className, ...props }: TrProps) => (
  <tr
    {...props}
    className={cn(
      "border-b border-border transition-colors hover:bg-muted/50",
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
  children?: ReactNode;
}

export const TableEmptyRow = ({ children, colSpan }: TableEmptyRowProps) => (
  <TableRow className="hover:bg-transparent">
    <TableCell
      className="py-10 text-center text-sm text-muted-foreground"
      colSpan={colSpan}
    >
      {children ?? "データがありません"}
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
            className="h-5 rounded-md bg-muted/70 motion-safe:animate-pulse"
          />
        </TableCell>
      </TableRow>
    ))}
  </>
);
