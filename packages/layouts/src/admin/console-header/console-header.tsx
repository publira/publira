import { Skeleton } from "@publira/ui-components/skeleton";
import { Suspense } from "react";
import type { JSX, ReactNode } from "react";

export const ConsoleHeaderSkeleton = (): JSX.Element => (
  <header className="sticky top-0 z-20 border-b border-border bg-background">
    <div className="mx-auto flex h-12 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
      <Skeleton className="h-4 w-40 rounded-control" />
      <Skeleton className="h-6 w-20 rounded-control" />
    </div>
  </header>
);

export const ConsoleHeaderUserSkeleton = (): JSX.Element => (
  <Skeleton className="size-9 rounded-control pointer-coarse:size-11" />
);

/** A 48px bar: what the console is showing on the left, its controls on the right. */
export const ConsoleHeader = ({
  children,
}: {
  children: ReactNode;
}): JSX.Element => (
  <Suspense fallback={<ConsoleHeaderSkeleton />}>
    <header className="sticky top-0 z-20 border-b border-border bg-background">
      <div className="mx-auto flex h-12 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        {children}
      </div>
    </header>
  </Suspense>
);

export const ConsoleHeaderContext = ({
  children,
}: {
  children: ReactNode;
}): JSX.Element => (
  <div className="flex min-w-0 items-center gap-2">{children}</div>
);

export const ConsoleHeaderText = ({
  children,
}: {
  children: ReactNode;
}): JSX.Element => <div className="min-w-0">{children}</div>;

export const ConsoleHeaderLabel = ({
  children,
}: {
  children: ReactNode;
}): JSX.Element => (
  <p className="truncate text-sm font-medium text-foreground">{children}</p>
);

export const ConsoleHeaderActions = ({
  children,
}: {
  children: ReactNode;
}): JSX.Element => <div className="flex items-center gap-2">{children}</div>;
