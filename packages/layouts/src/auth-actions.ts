import type { LayoutActionItem } from "./site-layout";

/**
 * Copy for the header's account actions.
 *
 * The labels come from the caller because this package is shared with the two
 * consoles, which resolve their locale from a cookie while the public site
 * resolves it from the URL. Neither can be read here, so the strings arrive
 * already resolved.
 */
export interface AuthActionLabels {
  login: string;
  myPage: string;
  signup: string;
}

export const getAuthActions = (
  hasSession: boolean,
  labels: AuthActionLabels
): {
  primaryAction: LayoutActionItem;
  secondaryAction?: LayoutActionItem;
} => {
  if (hasSession) {
    return {
      primaryAction: { href: "/my", label: labels.myPage },
    };
  }

  return {
    primaryAction: { href: "/signup", label: labels.signup },
    secondaryAction: { href: "/login", label: labels.login },
  };
};
