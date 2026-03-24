"use client";

import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import { CloseIcon, MenuIcon } from "@publira/icons";
import { StatusChip } from "@publira/ui-components/badge";
import { Button } from "@publira/ui-components/button";
import { cn } from "@publira/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

import type { NavSection } from "../navigation";
import { isCurrentPath } from "../navigation";

interface ConsoleNavState {
  mobileNavOpen: boolean;
  onOpenMobileNav: () => void;
  onCloseMobileNav: () => void;
  pathname: string;
}

const ConsoleNavContext = createContext<ConsoleNavState | null>(null);

const useConsoleNav = () => {
  const context = useContext(ConsoleNavContext);
  if (!context) {
    throw new Error("ConsoleNavContext is not provided");
  }
  return context;
};

// ─── ConsoleLayout ────────────────────────────────────────────────────────────

export interface ConsoleLayoutProps {
  children: ReactNode;
  gradient?: string;
  header: ReactNode;
  sidebar: ReactNode;
}

export const defaultConsoleGradient =
  "bg-[radial-gradient(circle_at_top_left,rgba(15,124,130,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(217,111,74,0.13),transparent_30%),linear-gradient(180deg,rgba(255,253,248,0.78),rgba(246,242,233,0.98))]";

export const ConsoleLayout = ({
  children,
  gradient = defaultConsoleGradient,
  header,
  sidebar,
}: ConsoleLayoutProps) => {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const onOpenMobileNav = useCallback(() => {
    setMobileNavOpen(true);
  }, []);
  const onCloseMobileNav = useCallback(() => {
    setMobileNavOpen(false);
  }, []);
  const handleOpenChange = useCallback((open: boolean) => {
    setMobileNavOpen(open);
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  const navState = useMemo(
    () => ({ mobileNavOpen, onCloseMobileNav, onOpenMobileNav, pathname }),
    [mobileNavOpen, onOpenMobileNav, onCloseMobileNav, pathname]
  );

  return (
    <ConsoleNavContext value={navState}>
      <BaseDrawer.Root
        modal
        onOpenChange={handleOpenChange}
        open={mobileNavOpen}
      >
        <div className="relative min-h-dvh bg-background text-foreground">
          <div
            aria-hidden="true"
            className={cn("pointer-events-none absolute inset-0", gradient)}
          />

          <div className="relative flex min-h-dvh">
            {sidebar}

            <div className="flex min-w-0 flex-1 flex-col lg:pl-0">
              {header}
              <main className="flex-1 overflow-x-hidden">{children}</main>
            </div>
          </div>
        </div>
      </BaseDrawer.Root>
    </ConsoleNavContext>
  );
};

// ─── ConsoleHeader ────────────────────────────────────────────────────────────

export interface ConsoleCurrentUser {
  name: string;
  publicId: string;
  role: string;
}

export interface ConsoleHeaderProps {
  navId: string;
  eyebrow: string;
  contextLabel: string;
  currentUser: ConsoleCurrentUser;
  actions?: ReactNode;
}

const roleLabelMap: Record<string, string> = {
  // 後方互換: 旧ロール値
  admin: "テナント管理者",
  auditor: "監査担当",
  editor: "編集担当",
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

export const ConsoleHeader = ({
  navId,
  eyebrow,
  contextLabel,
  currentUser,
  actions,
}: ConsoleHeaderProps) => {
  const { mobileNavOpen, onOpenMobileNav } = useConsoleNav();
  const roleLabel = toRoleLabel(currentUser.role);

  return (
    <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <button
            aria-controls={navId}
            aria-expanded={mobileNavOpen}
            aria-label="ナビゲーションを開く"
            className="inline-flex size-10 items-center justify-center rounded-md border border-border/70 bg-card text-foreground shadow-sm transition-colors hover:bg-muted/60 lg:hidden"
            onClick={onOpenMobileNav}
            type="button"
          >
            <MenuIcon className="size-5" />
          </button>

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
          <div className="hidden min-w-0 text-right sm:block">
            <p className="truncate text-sm font-medium text-foreground">
              {currentUser.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {currentUser.publicId}
            </p>
          </div>
          <StatusChip className="hidden sm:inline-flex" status="info">
            {roleLabel}
          </StatusChip>
          {actions}
          <form action="/logout" method="post">
            <Button size="sm" type="submit" variant="outline">
              ログアウト
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
};

// ─── ConsoleSidebar ───────────────────────────────────────────────────────────

export interface ConsoleSidebarProps {
  navId: string;
  logoLabel: string;
  contextInfo: ReactNode;
  navigation: NavSection[];
  footerNote: ReactNode;
}

export const ConsoleSidebar = ({
  navId,
  logoLabel,
  contextInfo,
  navigation,
  footerNote,
}: ConsoleSidebarProps) => {
  const { onCloseMobileNav, pathname } = useConsoleNav();

  const sidebarContent = (mobile: boolean) => (
    <>
      <div className="flex items-center justify-between gap-3 px-2 pb-4">
        <Link className="min-w-0" href="/">
          <p className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Publira
          </p>
          <p className="text-xs tracking-[0.22em] text-muted-foreground uppercase">
            {logoLabel}
          </p>
        </Link>

        {mobile ? (
          <button
            aria-label="ナビゲーションを閉じる"
            className="inline-flex size-10 items-center justify-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:border-border hover:bg-muted/60 hover:text-foreground lg:hidden"
            onClick={onCloseMobileNav}
            type="button"
          >
            <CloseIcon className="size-4" />
          </button>
        ) : null}
      </div>

      <div className="rounded-2xl border border-border/70 bg-muted/45 p-4">
        {contextInfo}
      </div>

      <nav className="mt-6 flex-1 overflow-y-auto">
        <div className="grid gap-5">
          {navigation.map((section) => (
            <div className="grid gap-2" key={section.title}>
              <p className="px-2 text-xs font-medium tracking-[0.22em] text-muted-foreground uppercase">
                {section.title}
              </p>
              <div className="grid gap-1.5">
                {section.items.map((item) => {
                  const allHrefs = navigation.flatMap((s) =>
                    s.items.map((i) => i.href)
                  );
                  const active = isCurrentPath(pathname, item.href, allHrefs);
                  const Icon = item.icon;

                  return (
                    <Link
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group grid grid-cols-[2.75rem_minmax(0,1fr)] items-start gap-3 rounded-2xl border px-3 py-3 transition-colors",
                        active
                          ? "border-primary/35 bg-primary/10 text-foreground shadow-[0_10px_30px_-24px_rgba(15,124,130,0.9)]"
                          : "border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/55 hover:text-foreground"
                      )}
                      href={item.href}
                      key={item.href}
                    >
                      <span
                        className={cn(
                          "flex size-11 items-center justify-center rounded-2xl border transition-colors",
                          active
                            ? "border-primary/20 bg-primary text-primary-foreground"
                            : "border-border/70 bg-card text-muted-foreground group-hover:border-border group-hover:text-foreground"
                        )}
                      >
                        <Icon className="size-5" />
                      </span>
                      <span className="grid gap-1">
                        <span className="text-sm font-medium">
                          {item.label}
                        </span>
                        <span className="text-xs leading-5 text-muted-foreground group-hover:text-muted-foreground">
                          {item.description}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      <div className="mt-6 rounded-2xl border border-border/70 bg-card p-4">
        {footerNote}
      </div>
    </>
  );

  return (
    <>
      <aside
        className="hidden w-72 max-w-none flex-col border-r border-border/70 bg-card/95 px-4 py-4 shadow-none backdrop-blur lg:flex"
        id={navId}
      >
        {sidebarContent(false)}
      </aside>

      <BaseDrawer.Portal>
        <BaseDrawer.Backdrop className="fixed inset-0 z-30 bg-foreground/20 backdrop-blur-xs lg:hidden" />
        <BaseDrawer.Popup
          className="fixed inset-y-0 left-0 z-40 flex w-74 max-w-[86vw] flex-col border-r border-border/70 bg-card/95 px-4 py-4 shadow-2xl backdrop-blur lg:hidden"
          id={navId}
        >
          {sidebarContent(true)}
        </BaseDrawer.Popup>
      </BaseDrawer.Portal>
    </>
  );
};
