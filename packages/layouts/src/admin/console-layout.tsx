import { StatusChip } from "@publira/ui-components/badge";
import { Button } from "@publira/ui-components/button";
import { Skeleton } from "@publira/ui-components/skeleton";
import { cn } from "@publira/utils";
import Link from "next/link";
import { Suspense } from "react";
import type { ReactNode } from "react";

import type { NavSection } from "../navigation";
import { ConsoleLayoutClient } from "./console-layout-client";

export interface ConsoleLayoutProps {
  children: ReactNode;
  gradient?: string;
}

export const defaultConsoleGradient =
  "bg-[radial-gradient(circle_at_top_left,rgba(15,124,130,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(217,111,74,0.13),transparent_30%),linear-gradient(180deg,rgba(255,253,248,0.78),rgba(246,242,233,0.98))]";

const ConsoleLayoutStaticShell = ({ gradient }: { gradient?: string }) => (
  <div className="relative min-h-dvh bg-background text-foreground">
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0",
        gradient ?? defaultConsoleGradient
      )}
    />
    <div className="relative flex min-h-dvh">
      <aside
        aria-hidden="true"
        className="hidden w-72 max-w-none flex-col border-r border-border/70 bg-card/95 px-4 py-4 lg:flex"
      >
        <div className="grid gap-3">
          <Skeleton className="h-5 w-24 rounded" />
          <Skeleton className="h-4 w-40 rounded" />
          <Skeleton className="h-48 w-full rounded" />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col lg:pl-0">
        <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 px-4 py-4 backdrop-blur">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4">
            <Skeleton className="h-6 w-48 rounded" />
            <Skeleton className="h-6 w-24 rounded" />
          </div>
        </header>
        <main className="flex-1 overflow-x-hidden">
          <div className="p-8" />
        </main>
      </div>
    </div>
  </div>
);

export const ConsoleLayout = ({ children, gradient }: ConsoleLayoutProps) => (
  <Suspense fallback={<ConsoleLayoutStaticShell gradient={gradient} />}>
    <ConsoleLayoutClient gradient={gradient}>{children}</ConsoleLayoutClient>
  </Suspense>
);

export const ConsoleLayoutMain = ({ children }: { children: ReactNode }) => (
  <main className="flex-1 overflow-x-hidden">{children}</main>
);

export const ConsoleLayoutContent = ({ children }: { children: ReactNode }) => (
  <div className="flex min-w-0 flex-1 flex-col lg:pl-0">{children}</div>
);

const roleLabelMap: Record<string, string> = {
  platform_auditor: "監査担当",
  platform_operator: "オペレーター",
  platform_owner: "プラットフォーム管理者",
  platform_super_admin: "スーパー管理者",
  tenant_admin: "テナント管理者",
  tenant_auditor: "監査担当",
  tenant_editor: "編集担当",
  tenant_member: "メンバー",
  tenant_owner: "オーナー",
};

const toRoleLabel = (role: string): string => {
  const normalized = role.trim().toLowerCase();
  if (!normalized) {
    return "権限未設定";
  }

  return roleLabelMap[normalized] ?? role.trim();
};

export const ConsoleHeaderSkeleton = () => (
  <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 px-4 py-4 backdrop-blur">
    <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4">
      <Skeleton className="h-6 w-48 rounded" />
      <Skeleton className="h-6 w-24 rounded" />
    </div>
  </header>
);

export const ConsoleSidebarSkeleton = () => (
  <aside
    className="hidden w-72 max-w-none flex-col border-r border-border/70 bg-card/95 px-4 py-4 lg:flex"
    aria-hidden="true"
  >
    <div className="grid gap-3">
      <Skeleton className="h-5 w-24 rounded" />
      <Skeleton className="h-4 w-40 rounded" />
      <Skeleton className="h-48 w-full rounded" />
    </div>
  </aside>
);

export const ConsoleHeaderUser = ({
  currentUser,
}: {
  currentUser: ConsoleCurrentUser;
}) => (
  <div className="flex items-center gap-2 sm:gap-3">
    <div className="hidden min-w-0 text-right sm:block">
      <p className="truncate text-sm font-medium text-foreground">
        {currentUser.name}
      </p>
      <p className="text-xs text-muted-foreground">{currentUser.publicId}</p>
    </div>
    <StatusChip className="hidden sm:inline-flex" status="info">
      {toRoleLabel(currentUser.role)}
    </StatusChip>
  </div>
);

export const ConsoleHeaderUserSkeleton = () => (
  <div className="flex items-center gap-2 sm:gap-3">
    <div className="hidden min-w-0 text-right sm:block">
      <Skeleton className="h-3.5 w-28 rounded" />
      <Skeleton className="mt-1 h-3 w-20 rounded" />
    </div>
    <Skeleton className="h-7 w-20 rounded" />
  </div>
);

export const ConsoleHeader = ({
  eyebrow,
  contextLabel,
  logoutAction,
  children,
}: ConsoleHeaderProps) => (
  <Suspense fallback={<ConsoleHeaderSkeleton />}>
    <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <p className="text-xs tracking-[0.24em] text-muted-foreground uppercase">
              {eyebrow}
            </p>
            <p className="truncate text-sm font-medium text-foreground sm:text-base">
              {contextLabel}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {children}
          <form action={logoutAction}>
            <Button size="sm" type="submit" variant="outline">
              ログアウト
            </Button>
          </form>
        </div>
      </div>
    </header>
  </Suspense>
);

export const ConsoleSidebar = ({
  logoLabel,
  navigation,
  footerNote,
  children,
}: ConsoleSidebarProps) => (
  <aside className="hidden w-72 max-w-none flex-col border-r border-border/70 bg-card/95 px-4 py-4 lg:flex">
    <div className="flex items-center justify-between gap-3 px-2 pb-4">
      <Link className="min-w-0" href="/">
        <p className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Publira
        </p>
        <p className="text-xs tracking-[0.22em] text-muted-foreground uppercase">
          {logoLabel}
        </p>
      </Link>
    </div>
    {children ? (
      <div className="rounded-2xl border border-border/70 bg-muted/45 p-4">
        {children}
      </div>
    ) : null}
    <nav className="mt-6 flex-1 overflow-y-auto">
      <div className="grid gap-5">
        {navigation.map((section) => (
          <div className="grid gap-2" key={section.title}>
            <p className="px-2 text-xs font-medium tracking-[0.22em] text-muted-foreground uppercase">
              {section.title}
            </p>
            <div className="grid gap-1.5">
              {section.items.map((item) => (
                <Link
                  className="group grid grid-cols-[2.75rem_minmax(0,1fr)] items-start gap-3 rounded-2xl border px-3 py-3 text-muted-foreground transition-colors hover:border-border/70 hover:bg-muted/55 hover:text-foreground"
                  href={item.href}
                  key={item.href}
                >
                  <span className="flex size-11 items-center justify-center rounded-2xl border border-border/70 bg-card text-muted-foreground group-hover:border-border group-hover:text-foreground">
                    <item.icon className="size-5" />
                  </span>
                  <span className="grid gap-1">
                    <span className="text-sm font-medium">{item.label}</span>
                    <span className="text-xs leading-5 text-muted-foreground group-hover:text-muted-foreground">
                      {item.description}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </nav>
    {footerNote ? (
      <div className="mt-6 rounded-2xl border border-border/70 bg-card p-4">
        {footerNote}
      </div>
    ) : null}
  </aside>
);

export interface ConsoleCurrentUser {
  name: string;
  publicId: string;
  role: string;
}

export interface ConsoleHeaderProps {
  eyebrow: string;
  contextLabel: string;
  logoutAction: (formData: FormData) => void | Promise<void>;
  children?: ReactNode;
}

export interface ConsoleSidebarProps {
  logoLabel: string;
  navigation: NavSection[];
  footerNote?: ReactNode;
  children?: ReactNode;
}
