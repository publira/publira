import { getMessage } from "@publira/i18n";
import type { SharedMessages } from "@publira/i18n/catalog";
import { z } from "zod";

import { buildQueryString } from "./query-string";

export const NOTIFICATION_TYPE_EPISODE_PUBLISHED = "episode_published";
export const NOTIFICATION_TYPE_EPISODE_PUBLISH_FAILED =
  "episode_publish_failed";
export const NOTIFICATION_TYPE_COMMENT_AWAITING_APPROVAL =
  "comment_awaiting_approval";
export const NOTIFICATION_TYPE_COMMENT_REPORTED = "comment_reported";

/**
 * Public IDs that can sit in a path segment. Anything else is dropped so a
 * payload cannot push the inbox onto `//`, query strings, or another origin.
 */
const resourceIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/u);

const labelSchema = z.string().trim().min(1);

/**
 * Invalid or empty values become `undefined` so one bad field does not drop
 * the rest of the object. Used as the inner schema of {@link payloadSchema}.
 */
const optionalResourceId = z.preprocess((value) => {
  const parsed = resourceIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}, resourceIdSchema.optional());

const optionalLabel = z.preprocess((value) => {
  const parsed = labelSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}, labelSchema.optional());

/**
 * Known inbox fields only. `z.object` strips unknown keys. A bad value on one
 * field becomes `undefined` so the rest of the payload can still be used.
 */
const payloadSchema = z.object({
  episode_id: optionalResourceId,
  episode_title: optionalLabel,
  series_id: optionalResourceId,
  series_title: optionalLabel,
});

export type NotificationPayload = z.output<typeof payloadSchema>;

export interface NotificationDisplay {
  description: string;
  href?: string;
  title: string;
}

/**
 * How an episode is named in a description.
 *
 * `unnamedKey` is the last resort, and it differs by event: a publication
 * notice is about an episode that was scheduled, while a comment alert is
 * about one readers are already reading. A payload that names neither the
 * episode nor its series is a malformed one, so this is copy nobody should
 * see — but it is the sentence the row falls back to, and naming the wrong
 * thing there is worse than naming nothing.
 */
const episodeSubject = (
  messages: SharedMessages,
  payload: NotificationPayload,
  unnamedKey:
    | "admin.notifications.events.subject_unknown"
    | "admin.notifications.events.subject_unnamed"
): string => {
  if (payload.episode_title && payload.series_title) {
    return getMessage(
      messages,
      "admin.notifications.events.subject_in_series",
      {
        episode: payload.episode_title,
        series: payload.series_title,
      }
    );
  }
  if (payload.episode_title) {
    return getMessage(messages, "admin.notifications.events.subject_episode", {
      episode: payload.episode_title,
    });
  }
  if (payload.series_title) {
    return getMessage(messages, "admin.notifications.events.subject_series", {
      series: payload.series_title,
    });
  }
  return getMessage(messages, unnamedKey);
};

export const notificationHref = (
  payload: NotificationPayload
): string | undefined => {
  if (payload.series_id && payload.episode_id) {
    return `/series/${payload.series_id}/episodes/${payload.episode_id}`;
  }
  if (payload.series_id) {
    return `/series/${payload.series_id}`;
  }
  return undefined;
};

export const parseNotificationPayload = (raw: string): NotificationPayload => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    const result = payloadSchema.safeParse(parsed);
    return result.success ? result.data : {};
  } catch {
    return {};
  }
};

/**
 * Inbox copy is assembled here from `notification_type` + payload. The API
 * does not store title/body. Unknown types stay in the list as a generic row.
 */
export const notificationDisplay = (
  notificationType: string,
  payload: NotificationPayload,
  messages: SharedMessages
): NotificationDisplay => {
  const href = notificationHref(payload);
  const type = notificationType.trim();

  if (type === NOTIFICATION_TYPE_EPISODE_PUBLISHED) {
    return {
      description: getMessage(
        messages,
        "admin.notifications.events.published_description",
        {
          subject: episodeSubject(
            messages,
            payload,
            "admin.notifications.events.subject_unnamed"
          ),
        }
      ),
      href,
      title: getMessage(messages, "admin.notifications.events.published_title"),
    };
  }

  if (type === NOTIFICATION_TYPE_EPISODE_PUBLISH_FAILED) {
    return {
      description: getMessage(
        messages,
        "admin.notifications.events.publish_failed_description",
        {
          subject: episodeSubject(
            messages,
            payload,
            "admin.notifications.events.subject_unnamed"
          ),
        }
      ),
      href,
      title: getMessage(
        messages,
        "admin.notifications.events.publish_failed_title"
      ),
    };
  }

  if (type === NOTIFICATION_TYPE_COMMENT_AWAITING_APPROVAL) {
    return {
      description: getMessage(
        messages,
        "admin.notifications.events.comments_awaiting_approval_description",
        {
          subject: episodeSubject(
            messages,
            payload,
            "admin.notifications.events.subject_unknown"
          ),
        }
      ),
      href: `/comments${buildQueryString({
        episode: payload.episode_id,
        status: "pending",
      })}`,
      title: getMessage(
        messages,
        "admin.notifications.events.comments_awaiting_approval_title"
      ),
    };
  }

  if (type === NOTIFICATION_TYPE_COMMENT_REPORTED) {
    return {
      description: getMessage(
        messages,
        "admin.notifications.events.comments_reported_description",
        {
          subject: episodeSubject(
            messages,
            payload,
            "admin.notifications.events.subject_unknown"
          ),
        }
      ),
      // The report queue carries no episode filter of its own, so the link
      // opens the reports still waiting rather than the ones on this episode.
      href: `/comments${buildQueryString({ report_status: "open" })}`,
      title: getMessage(
        messages,
        "admin.notifications.events.comments_reported_title"
      ),
    };
  }

  return {
    description: getMessage(
      messages,
      "admin.notifications.events.unknown_description"
    ),
    href,
    title: getMessage(messages, "admin.notifications.events.unknown_title"),
  };
};
