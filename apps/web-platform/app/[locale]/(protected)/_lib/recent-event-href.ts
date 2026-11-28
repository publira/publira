import type { PlatformDashboardRecentEvent } from "#lib/dashboard";

/**
 * The page a recent event's target opens. Each kind's `target` is the public
 * id of a different table in `ListRecentPlatformEvents` — a tenant, a
 * platform user, an end user — so each goes to the page that looks that table
 * up.
 */
export const buildRecentEventHref = (
  event: Pick<PlatformDashboardRecentEvent, "eventType" | "target">
): string | null => {
  if (!event.target) {
    return null;
  }

  switch (event.eventType) {
    case "tenant_created": {
      return `/tenants/${event.target}`;
    }

    case "operator_role_granted": {
      return `/operators/${event.target}`;
    }

    case "end_user_created": {
      return `/users/${event.target}`;
    }

    default: {
      return null;
    }
  }
};
