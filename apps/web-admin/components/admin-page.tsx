import { cn } from "@publira/utils";
import type { ReactNode } from "react";

export interface AdminPageProps {
  children: ReactNode;
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
}

export const AdminPage = ({
  actions,
  children,
  className,
  description,
  eyebrow = "Admin Workspace",
  title,
}: AdminPageProps) => (
  <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
    <header className="grid gap-4 rounded-[1.75rem] border border-border/70 bg-card/80 p-6 shadow-[0_18px_50px_-30px_rgba(30,43,56,0.45)] backdrop-blur sm:p-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
      <div className="grid gap-2">
        <p className="text-xs font-medium tracking-[0.24em] text-muted-foreground uppercase">
          {eyebrow}
        </p>
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
              {description}
            </p>
          ) : null}
        </div>
      </div>

      {actions ? (
        <div className="flex flex-wrap items-center gap-3 lg:justify-end">
          {actions}
        </div>
      ) : null}
    </header>

    <div className={cn("grid gap-6", className)}>{children}</div>
  </section>
);
