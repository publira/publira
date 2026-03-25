import type { LayoutActionItem } from "./site-layout";

export const getAuthActions = (
  hasSession: boolean
): { primaryAction: LayoutActionItem; secondaryAction: LayoutActionItem } => {
  if (hasSession) {
    return {
      primaryAction: { href: "/my", label: "My Page" },
      secondaryAction: { href: "/logout", label: "Logout" },
    };
  }

  return {
    primaryAction: { href: "/signup", label: "Start" },
    secondaryAction: { href: "/login", label: "Sign in" },
  };
};
