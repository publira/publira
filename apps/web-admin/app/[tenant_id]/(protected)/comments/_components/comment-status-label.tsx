import { getMessage } from "@publira/i18n";
import type { SharedMessages } from "@publira/i18n/catalog";
import type { BadgeTone } from "@publira/ui-components/badge";

import { Message } from "#components/message";

import type { CommentStatus } from "../comment-types";

/**
 * The name one stored state goes by, rendered as its own catalog string.
 *
 * Each branch names its key inside the `<Message>` it returns, so the key is
 * where a translation extractor can see it: a helper that returned only the
 * key would take every one of these strings out of reach of that pass. The
 * `<Suspense>` boundary stays at the call site, where its fallback is sized.
 */
export const CommentStatusMessage = ({ status }: { status: CommentStatus }) => {
  switch (status) {
    case "pending": {
      return <Message message="admin.comments.status_pending" />;
    }
    case "published": {
      return <Message message="admin.comments.status_published" />;
    }
    case "hidden": {
      return <Message message="admin.comments.status_hidden" />;
    }
    default: {
      return <Message message="admin.comments.status_withdrawn" />;
    }
  }
};

/**
 * The same name resolved to a string, for the one place that cannot render a
 * node: the `<option>` labels the status filter hands to its Client Component.
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
