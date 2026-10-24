import type { Locale } from "@publira/i18n";
import type { BadgeTone } from "@publira/ui-components/badge";
import { formatDateTime } from "@publira/utils";

import { Message } from "#components/message";

/**
 * The ticket's status, worded one branch at a time. Each branch names its key
 * inside the `<Message>` it returns, so the key stays where anything reading
 * this file for the strings the screen uses can see it.
 */
export const TicketStatusLabel = ({ status }: { status: string }) => {
  switch (status) {
    case "active": {
      return <Message message="admin.access_tickets.status_active" />;
    }
    case "expired": {
      return <Message message="admin.access_tickets.status_expired" />;
    }
    case "revoked": {
      return <Message message="admin.access_tickets.status_revoked" />;
    }
    default: {
      return status;
    }
  }
};

export const ticketStatusTone = (status: string): BadgeTone => {
  switch (status) {
    case "active": {
      return "success";
    }
    case "expired": {
      return "warning";
    }
    case "revoked": {
      return "muted";
    }
    default: {
      return "info";
    }
  }
};

// Absolute API timestamp → tenant display zone. `formatDateTime` falls back to
// the raw value when it cannot be parsed, so only the empty case is special.
export const formatTicketDateTime = (
  value: string,
  locale: Locale,
  timeZone: string
): string => (value ? formatDateTime(value, { locale, timeZone }) : "—");
