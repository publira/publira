import type { Locale } from "@publira/i18n";
import { z } from "zod";

import { getMessagesFor } from "./messages";
import { buildQueryString } from "./query-string";

export const NOTIFICATION_TYPE_EPISODE_PUBLISHED = "episode_published";
export const NOTIFICATION_TYPE_EPISODE_PUBLISH_FAILED =
  "episode_publish_failed";
export const NOTIFICATION_TYPE_COMMENT_AWAITING_APPROVAL =
  "comment_awaiting_approval";
export const NOTIFICATION_TYPE_COMMENT_REPORTED = "comment_reported";
export const NOTIFICATION_TYPE_ANNOUNCEMENT_POSTED = "announcement_posted";

/**
 * Where an `announcement_posted` row takes a member of staff: the delivery
 * list this console posts from, not the reader's own inbox on the storefront.
 */
const ANNOUNCEMENTS_HREF = "/announcements";

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
  announcement_title: optionalLabel,
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
 * `unnamed` is the last resort, and it differs by event: a publication
 * notice is about an episode that was scheduled, while a comment alert is
 * about one readers are already reading. A payload that names neither the
 * episode nor its series is a malformed one, so this is copy nobody should
 * see — but it is the sentence the row falls back to, and naming the wrong
 * thing there is worse than naming nothing.
 */
const episodeSubject = async (
  locale: Locale,
  payload: NotificationPayload,
  unnamed: string
): Promise<string> => {
  const t = await getMessagesFor(locale);
  if (payload.episode_title && payload.series_title) {
    return t("admin.notifications.events.subject_in_series", {
      episode: payload.episode_title,
      series: payload.series_title,
    });
  }
  if (payload.episode_title) {
    return t("admin.notifications.events.subject_episode", {
      episode: payload.episode_title,
    });
  }
  if (payload.series_title) {
    return t("admin.notifications.events.subject_series", {
      series: payload.series_title,
    });
  }
  return unnamed;
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
export const notificationDisplay = async (
  notificationType: string,
  payload: NotificationPayload,
  locale: Locale
): Promise<NotificationDisplay> => {
  const t = await getMessagesFor(locale);
  const href = notificationHref(payload);
  const type = notificationType.trim();

  if (type === NOTIFICATION_TYPE_ANNOUNCEMENT_POSTED) {
    // An announcement addresses every user of the tenant, staff included, so
    // this row reaches the console as well as the storefront bell.
    return {
      description: payload.announcement_title
        ? t("admin.notifications.events.announcement_posted_description", {
            title: payload.announcement_title,
          })
        : t(
            "admin.notifications.events.announcement_posted_description_unknown"
          ),
      href: ANNOUNCEMENTS_HREF,
      title: t("admin.notifications.events.announcement_posted_title"),
    };
  }

  if (type === NOTIFICATION_TYPE_EPISODE_PUBLISHED) {
    const subject = await episodeSubject(
      locale,
      payload,
      t("admin.notifications.events.subject_unnamed")
    );

    return {
      description: t("admin.notifications.events.published_description", {
        subject,
      }),
      href,
      title: t("admin.notifications.events.published_title"),
    };
  }

  if (type === NOTIFICATION_TYPE_EPISODE_PUBLISH_FAILED) {
    const subject = await episodeSubject(
      locale,
      payload,
      t("admin.notifications.events.subject_unnamed")
    );

    return {
      description: t("admin.notifications.events.publish_failed_description", {
        subject,
      }),
      href,
      title: t("admin.notifications.events.publish_failed_title"),
    };
  }

  if (type === NOTIFICATION_TYPE_COMMENT_AWAITING_APPROVAL) {
    const subject = await episodeSubject(
      locale,
      payload,
      t("admin.notifications.events.subject_unknown")
    );

    return {
      description: t(
        "admin.notifications.events.comments_awaiting_approval_description",
        { subject }
      ),
      href: `/comments${buildQueryString({
        episode: payload.episode_id,
        status: "pending",
      })}`,
      title: t("admin.notifications.events.comments_awaiting_approval_title"),
    };
  }

  if (type === NOTIFICATION_TYPE_COMMENT_REPORTED) {
    const subject = await episodeSubject(
      locale,
      payload,
      t("admin.notifications.events.subject_unknown")
    );

    return {
      description: t(
        "admin.notifications.events.comments_reported_description",
        { subject }
      ),
      // The report queue carries no episode filter of its own, so the link
      // opens the reports still waiting rather than the ones on this episode.
      href: `/comments${buildQueryString({ report_status: "open" })}`,
      title: t("admin.notifications.events.comments_reported_title"),
    };
  }

  return {
    description: t("admin.notifications.events.unknown_description"),
    href,
    title: t("admin.notifications.events.unknown_title"),
  };
};
