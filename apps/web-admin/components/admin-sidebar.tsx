import { CloseIcon } from "@publira/icons";
import { StatusChip } from "@publira/ui-components/badge";
import { cn } from "@publira/utils";
import Link from "next/link";

import { isCurrentPath, navigation } from "./admin-navigation";

export interface AdminSidebarProps {
  pathname: string;
  mobileNavOpen: boolean;
  onClose: () => void;
}

export const AdminSidebar = ({
  pathname,
  mobileNavOpen,
  onClose,
}: AdminSidebarProps) => (
  <>
    <button
      aria-hidden={!mobileNavOpen}
      className={cn(
        "fixed inset-0 z-30 bg-foreground/20 backdrop-blur-xs transition-opacity lg:hidden",
        mobileNavOpen ? "opacity-100" : "pointer-events-none opacity-0"
      )}
      onClick={onClose}
      tabIndex={mobileNavOpen ? 0 : -1}
      type="button"
    />

    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex w-74 max-w-[86vw] flex-col border-r border-border/70 bg-card/95 px-4 py-4 shadow-2xl backdrop-blur transition-transform duration-200 lg:static lg:w-72 lg:max-w-none lg:translate-x-0 lg:shadow-none",
        mobileNavOpen ? "translate-x-0" : "-translate-x-full"
      )}
      id="admin-navigation"
    >
      <div className="flex items-center justify-between gap-3 px-2 pb-4">
        <Link className="min-w-0" href="/">
          <p className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Publira
          </p>
          <p className="text-xs tracking-[0.22em] text-muted-foreground uppercase">
            Admin Console
          </p>
        </Link>

        <button
          aria-label="ナビゲーションを閉じる"
          className="inline-flex size-10 items-center justify-center rounded-full border border-border/70 text-muted-foreground transition-colors hover:border-border hover:bg-muted/60 hover:text-foreground lg:hidden"
          onClick={onClose}
          type="button"
        >
          <CloseIcon className="size-4" />
        </button>
      </div>

      <div className="rounded-2xl border border-border/70 bg-muted/45 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <p className="text-sm font-medium text-foreground">青楓出版</p>
            <p className="text-xs leading-5 text-muted-foreground">
              編集チーム向けの認証後レイアウト。シリーズを起点に、配下のエピソードとブランド設定を同じ導線で運用できます。
            </p>
          </div>
          <StatusChip status="success">Online</StatusChip>
        </div>
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
                  const active = isCurrentPath(pathname, item.href);
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
        <p className="text-sm font-medium text-foreground">
          モバイル切り替え対応
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          サイドバーは小さい画面ではドロワーに切り替わり、将来の管理画面でも同じナビゲーション構造を再利用できます。
        </p>
      </div>
    </aside>
  </>
);
