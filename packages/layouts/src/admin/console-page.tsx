import { cn } from "@publira/utils";
import type { ReactNode } from "react";

/**
 * Compound page scaffold for the admin / platform consoles.
 *
 * Composed rather than prop-driven so any slot can hold a `<Suspense>`
 * boundary: URL-dependent headings stream on their own while the rest of the
 * chrome stays in the static shell.
 *
 * ```tsx
 * <ConsolePage>
 *   <ConsolePageHeader>
 *     <ConsolePageHeading>
 *       <ConsolePageEyebrow>Console</ConsolePageEyebrow>
 *       <ConsolePageTitle>タイトル</ConsolePageTitle>
 *       <ConsolePageDescription>説明</ConsolePageDescription>
 *     </ConsolePageHeading>
 *     <ConsolePageActions>{actions}</ConsolePageActions>
 *   </ConsolePageHeader>
 *   <ConsolePageContent>{children}</ConsolePageContent>
 * </ConsolePage>
 * ```
 */
export const ConsolePage = ({ children }: { children: ReactNode }) => (
  <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
    {children}
  </section>
);

export const ConsolePageHeader = ({ children }: { children: ReactNode }) => (
  <header className="grid gap-4 rounded-[1.75rem] border border-border/70 bg-card/80 p-6 shadow-[0_18px_50px_-30px_rgba(30,43,56,0.45)] backdrop-blur sm:p-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
    {children}
  </header>
);

/** Eyebrow / title / description stack. `mb-1` on the eyebrow keeps the
 * eyebrow→title gap at 8px while title→description stays 4px. */
export const ConsolePageHeading = ({ children }: { children: ReactNode }) => (
  <div className="grid gap-1">{children}</div>
);

export const ConsolePageEyebrow = ({ children }: { children: ReactNode }) => (
  <p className="mb-1 text-xs font-medium tracking-[0.24em] text-muted-foreground uppercase">
    {children}
  </p>
);

export const ConsolePageTitle = ({ children }: { children: ReactNode }) => (
  <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
    {children}
  </h1>
);

export const ConsolePageDescription = ({
  children,
}: {
  children: ReactNode;
}) => (
  <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
    {children}
  </p>
);

export const ConsolePageActions = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-wrap items-center gap-3 lg:justify-end">
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
