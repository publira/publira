import { cn } from "@publira/utils";
import type { ReactNode } from "react";

/**
 * One part of a console page: a heading, what that part is for, and the table
 * or the form it holds.
 *
 * A section is a heading and a gap, not a surface. A box drawn around one form
 * draws a second boundary around something the heading has already named, and
 * a page of such boxes reads as a dashboard rather than as a workbench. What
 * separates one section from the next is the space between them.
 *
 * A screen with a single table or a single form needs no section at all: the
 * page heading names it, and the table goes directly under it.
 *
 * ```tsx
 * <ConsoleSection>
 *   <ConsoleSectionHeader>
 *     <ConsoleSectionHeading>
 *       <ConsoleSectionTitle>Time zone</ConsoleSectionTitle>
 *       <ConsoleSectionDescription>…</ConsoleSectionDescription>
 *     </ConsoleSectionHeading>
 *     <ConsoleSectionActions>{actions}</ConsoleSectionActions>
 *   </ConsoleSectionHeader>
 *   {form}
 * </ConsoleSection>
 * ```
 */
export const ConsoleSection = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => <section className={cn("grid gap-4", className)}>{children}</section>;

export const ConsoleSectionHeader = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
    {children}
  </div>
);

export const ConsoleSectionHeading = ({
  children,
}: {
  children: ReactNode;
}) => <div className="grid gap-1">{children}</div>;

export const ConsoleSectionTitle = ({
  children,
  id,
}: {
  children: ReactNode;
  /** For an `aria-labelledby` elsewhere on the screen that names this section. */
  id?: string;
}) => (
  <h2 className="text-xl leading-tight font-medium text-foreground" id={id}>
    {children}
  </h2>
);

export const ConsoleSectionDescription = ({
  children,
}: {
  children: ReactNode;
}) => <p className="max-w-3xl text-sm text-muted-foreground">{children}</p>;

export const ConsoleSectionActions = ({
  children,
}: {
  children: ReactNode;
}) => (
  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
    {children}
  </div>
);

/**
 * The stack several sections sit in.
 *
 * The gap is wider than the one inside a section, because it is the only thing
 * telling one section from the next.
 */
export const ConsoleSections = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => <div className={cn("grid gap-10", className)}>{children}</div>;
