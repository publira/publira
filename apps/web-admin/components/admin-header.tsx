import { MenuIcon } from "@publira/icons";
import { StatusChip } from "@publira/ui-components/badge";
import { Button } from "@publira/ui-components/button";

export interface AdminHeaderProps {
  currentUser: {
    name: string;
    publicId: string;
    role: string;
  };
  mobileNavOpen: boolean;
  onOpenMobileNav: () => void;
}

export const AdminHeader = ({
  currentUser,
  mobileNavOpen,
  onOpenMobileNav,
}: AdminHeaderProps) => (
  <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 backdrop-blur">
    <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button
          aria-controls="admin-navigation"
          aria-expanded={mobileNavOpen}
          aria-label="ナビゲーションを開く"
          className="inline-flex size-11 items-center justify-center rounded-full border border-border/70 bg-card text-foreground shadow-sm transition-colors hover:bg-muted/60 lg:hidden"
          onClick={onOpenMobileNav}
          type="button"
        >
          <MenuIcon className="size-5" />
        </button>

        <div className="min-w-0">
          <p className="text-xs tracking-[0.24em] text-muted-foreground uppercase">
            Editorial Operations
          </p>
          <p className="truncate text-sm font-medium text-foreground sm:text-base">
            管理画面共通レイアウト
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <div className="hidden min-w-0 text-right sm:block">
          <p className="truncate text-sm font-medium text-foreground">
            {currentUser.name || "ログイン中のユーザー"}
          </p>
          <p className="text-xs text-muted-foreground">
            {currentUser.publicId}
          </p>
        </div>
        <StatusChip className="hidden sm:inline-flex" status="info">
          {currentUser.role || "admin"}
        </StatusChip>
        <Button size="sm" type="button" variant="outline">
          プレビュー
        </Button>
        <form action="/logout" method="post">
          <Button size="sm" type="submit" variant="outline">
            ログアウト
          </Button>
        </form>
      </div>
    </div>
  </header>
);
