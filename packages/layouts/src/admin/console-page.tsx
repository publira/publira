import { cn } from "@publira/utils";
import type { ReactNode } from "react";

/**
 * Compound page scaffold for the admin / platform consoles.
 *
 * A console page is a workbench: a heading, then the table or the form the
 * screen is for. The header is a plain row rather than a surface of its own,
 * so nothing is wrapped around either.
 *
 * Composed rather than prop-driven so any slot can hold a `<Suspense>`
 * boundary: URL-dependent headings stream on their own while the rest of the
 * chrome stays in the static shell.
 *
 * ```tsx
 * <ConsolePage>
 *   <ConsolePageHeader>
 *     <ConsolePageHeading>
 *       <ConsolePageContext>Series SR01</ConsolePageContext>
 *       <ConsolePageTitle>Title</ConsolePageTitle>
 *       <ConsolePageDescription>Description</ConsolePageDescription>
 *     </ConsolePageHeading>
 *     <ConsolePageActions>{actions}</ConsolePageActions>
 *   </ConsolePageHeader>
 *   <ConsolePageContent>{children}</ConsolePageContent>
 * </ConsolePage>
 * ```
 */
export const ConsolePage = ({ children }: { children: ReactNode }) => (
  <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
    {children}
  </section>
);

export const ConsolePageHeader = ({ children }: { children: ReactNode }) => (
  <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
    {children}
  </header>
);

export const ConsolePageHeading = ({ children }: { children: ReactNode }) => (
  <div className="grid gap-1">{children}</div>
);

/**
 * What the screen below is part of, when the reader needs it to place the page
 * — the series an episode form belongs to, say. Secondary text in a sentence,
 * not a label above the heading: a page whose title says enough on its own
 * leaves this out.
 */
export const ConsolePageContext = ({ children }: { children: ReactNode }) => (
  <p className="text-sm text-muted-foreground">{children}</p>
);

export const ConsolePageTitle = ({ children }: { children: ReactNode }) => (
  <h1 className="text-2xl font-semibold text-foreground">{children}</h1>
);

export const ConsolePageDescription = ({
  children,
}: {
  children: ReactNode;
}) => <p className="max-w-3xl text-sm text-muted-foreground">{children}</p>;

export const ConsolePageActions = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
    {children}
  </div>
);

export const ConsolePageContent = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => <div className={cn("grid gap-6", className)}>{children}</div>;
