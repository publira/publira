import { getMessage } from "@publira/i18n";
import type { SharedMessages } from "@publira/i18n/catalog";
import type { BadgeTone } from "@publira/ui-components/badge";

import type {
  CommentReportReason,
  CommentReportStatus,
} from "../comment-types";

/**
 * The name one stored report state goes by on screen.
 *
 * Written as a `switch` over literal keys rather than as
 * `admin.comments.reports.status_${status}`, for the reason
 * {@link commentStatusLabel} is: a key assembled by interpolation is never
 * checked against the catalog, so a state renamed in the proto would render an
 * empty cell instead of failing the build.
 */
export const commentReportStatusLabel = (
  status: CommentReportStatus,
  messages: SharedMessages
): string => {
  switch (status) {
    case "open": {
      return getMessage(messages, "admin.comments.reports.status_open");
    }
    case "resolved": {
      return getMessage(messages, "admin.comments.reports.status_resolved");
    }
    default: {
      return getMessage(messages, "admin.comments.reports.status_rejected");
    }
  }
};

export const commentReportStatusTone = (
  status: CommentReportStatus
): BadgeTone => {
  switch (status) {
    case "open": {
      return "warning";
    }
    case "resolved": {
      return "info";
    }
    default: {
      return "muted";
    }
  }
};

/**
 * What the reporter picked, in the wording the reader was offered it in.
 *
 * A reason this build does not know reads as "Something else", which is the
 * option the four are meant to fall back to.
 */
export const commentReportReasonLabel = (
  reason: CommentReportReason,
  messages: SharedMessages
): string => {
  switch (reason) {
    case "spam": {
      return getMessage(messages, "admin.comments.reports.reason_spam");
    }
    case "abuse": {
      return getMessage(messages, "admin.comments.reports.reason_abuse");
    }
    case "spoiler": {
      return getMessage(messages, "admin.comments.reports.reason_spoiler");
    }
    default: {
      return getMessage(messages, "admin.comments.reports.reason_other");
    }
  }
};
