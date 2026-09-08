import { getMessage } from "@publira/i18n";
import type { SharedMessages } from "@publira/i18n/catalog";
import type { BadgeTone } from "@publira/ui-components/badge";

import type { AdminMessageKey } from "#components/message";

import type { CommentStatus } from "../comment-types";

/**
 * The catalog key one stored state is named by, for `<Message message={…} />`.
 *
 * Written as a `switch` over literal keys rather than as
 * `admin.comments.status_${status}`: a key assembled by interpolation is never
 * checked against the catalog, so a state renamed in the proto would render an
 * empty cell instead of failing the build.
 */
export const commentStatusMessage = (
  status: CommentStatus
): AdminMessageKey => {
  switch (status) {
    case "pending": {
      return "admin.comments.status_pending";
    }
    case "published": {
      return "admin.comments.status_published";
    }
    case "hidden": {
      return "admin.comments.status_hidden";
    }
    default: {
      return "admin.comments.status_withdrawn";
    }
  }
};

/**
 * The same name resolved to a string, for the one place that cannot render a
 * node: the `<option>` labels the status filter hands to its Client Component.
 * Anything rendered as a child uses {@link commentStatusMessage} instead.
 */
export const commentStatusLabel = (
  status: CommentStatus,
  messages: SharedMessages
): string => getMessage(messages, commentStatusMessage(status));

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
