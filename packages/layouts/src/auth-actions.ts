import type { LayoutActionItem } from "./site-layout";

export const getAuthActions = (
  hasSession: boolean
): { primaryAction: LayoutActionItem; secondaryAction: LayoutActionItem } => {
  if (hasSession) {
    return {
      primaryAction: { href: "/my", label: "My Page" },
      // `/logout` は GET でセッションを破棄する Route Handler なので、
      // prefetch でログアウトさせないよう素の `<a>` のままにする（#655 で解消予定）。
      secondaryAction: {
        hardNavigation: true,
        href: "/logout",
        label: "Logout",
      },
    };
  }

  return {
    primaryAction: { href: "/signup", label: "Start" },
    secondaryAction: { href: "/login", label: "Sign in" },
  };
};
