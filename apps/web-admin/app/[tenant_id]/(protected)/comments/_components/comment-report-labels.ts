import type { BadgeTone } from "@publira/ui-components/badge";

import type { AdminMessageKey } from "#components/message";

import type {
  CommentReportReason,
  CommentReportStatus,
} from "../comment-types";

/**
 * The catalog key one stored report state is named by.
 *
 * A key rather than a resolved string, so the caller renders it through
 * `<Message message={…} />` inside its own boundary. Written as a `switch` over
 * literal keys rather than as `admin.comments.reports.status_${status}`, for
 * the reason {@link commentStatusMessage} is: an interpolated key is never
 * checked against the catalog, so a state renamed in the proto would render an
 * empty cell instead of failing the build.
 */
export const commentReportStatusMessage = (
  status: CommentReportStatus
): AdminMessageKey => {
  switch (status) {
    case "open": {
      return "admin.comments.reports.status_open";
    }
    case "resolved": {
      return "admin.comments.reports.status_resolved";
    }
    default: {
      return "admin.comments.reports.status_rejected";
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
export const commentReportReasonMessage = (
  reason: CommentReportReason
): AdminMessageKey => {
  switch (reason) {
    case "spam": {
      return "admin.comments.reports.reason_spam";
    }
    case "abuse": {
      return "admin.comments.reports.reason_abuse";
    }
    case "spoiler": {
      return "admin.comments.reports.reason_spoiler";
    }
    default: {
      return "admin.comments.reports.reason_other";
    }
  }
};
