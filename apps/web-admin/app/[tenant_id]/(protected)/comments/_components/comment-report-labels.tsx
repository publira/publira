import type { BadgeTone } from "@publira/ui-components/badge";

import { Message } from "#components/message";

import type {
  CommentReportReason,
  CommentReportStatus,
} from "../comment-types";

/**
 * The name one stored report state goes by, rendered as its own catalog
 * string.
 *
 * Each branch names its key inside the `<Message>` it returns, so the key stays
 * where a translation extractor can see it: a helper that returned only the key
 * would take every one of these strings out of reach of that pass. The
 * `<Suspense>` boundary stays at the call site, where its fallback is sized.
 */
export const CommentReportStatusMessage = ({
  status,
}: {
  status: CommentReportStatus;
}) => {
  switch (status) {
    case "open": {
      return <Message message="admin.comments.reports.status_open" />;
    }
    case "resolved": {
      return <Message message="admin.comments.reports.status_resolved" />;
    }
    default: {
      return <Message message="admin.comments.reports.status_rejected" />;
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
export const CommentReportReasonMessage = ({
  reason,
}: {
  reason: CommentReportReason;
}) => {
  switch (reason) {
    case "spam": {
      return <Message message="admin.comments.reports.reason_spam" />;
    }
    case "abuse": {
      return <Message message="admin.comments.reports.reason_abuse" />;
    }
    case "spoiler": {
      return <Message message="admin.comments.reports.reason_spoiler" />;
    }
    default: {
      return <Message message="admin.comments.reports.reason_other" />;
    }
  }
};
