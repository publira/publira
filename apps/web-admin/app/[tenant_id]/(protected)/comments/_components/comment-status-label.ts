import { getMessage } from "@publira/i18n";
import type { SharedMessages } from "@publira/i18n/catalog";
import type { BadgeTone } from "@publira/ui-components/badge";

import type { CommentStatus } from "../comment-types";

/**
 * The name one stored state goes by on screen.
 *
 * Written as a `switch` over literal keys rather than as
 * `admin.comments.status_${status}`: a key assembled by interpolation is never
 * checked against the catalog, so a state renamed in the proto would render an
 * empty cell instead of failing the build.
 */
export const commentStatusLabel = (
  status: CommentStatus,
  messages: SharedMessages
): string => {
  switch (status) {
    case "pending": {
      return getMessage(messages, "admin.comments.status_pending");
    }
    case "published": {
      return getMessage(messages, "admin.comments.status_published");
    }
    case "hidden": {
      return getMessage(messages, "admin.comments.status_hidden");
    }
    default: {
      return getMessage(messages, "admin.comments.status_withdrawn");
    }
  }
};

export const commentStatusTone = (status: CommentStatus): BadgeTone => {
  switch (status) {
    case "pending": {
      return "warning";
    }
    case "published": {
      return "success";
    }
    case "hidden": {
      return "destructive";
    }
    default: {
      return "muted";
    }
  }
};
