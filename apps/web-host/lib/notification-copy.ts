import type { Locale } from "@publira/i18n";
import { z } from "zod";

import type { HostMessageAccessor } from "./messages";
import { getMessagesFor } from "./messages";

export const NOTIFICATION_TYPE_EPISODE_PUBLISHED = "episode_published";
export const NOTIFICATION_TYPE_COMMENT_APPROVED = "comment_approved";
export const NOTIFICATION_TYPE_COMMENT_HIDDEN = "comment_hidden";
export const NOTIFICATION_TYPE_ANNOUNCEMENT_POSTED = "announcement_posted";

/** Where an `announcement_posted` row takes the reader: the whole inbox. */
const ANNOUNCEMENTS_HREF = "/announcements";

/** The `hidden_reason` categories `comment_hidden` carries. */
const COMMENT_HIDDEN_REASON_STAFF = "staff";
const COMMENT_HIDDEN_REASON_AUTO_REPORTS = "auto_reports";

/**
 * Public IDs that can sit in a path segment. Anything else is dropped so a
 * payload cannot push the inbox onto `//`, query strings, or another origin.
 */
const resourceIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/u);

const labelSchema = z.string().trim().min(1);

const hiddenReasonSchema = z.enum([
  COMMENT_HIDDEN_REASON_STAFF,
  COMMENT_HIDDEN_REASON_AUTO_REPORTS,
]);

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
 * A category this build does not know reads as no category at all, so a reason
 * added on the server later shows the plain sentence rather than nothing.
 */
const optionalHiddenReason = z.preprocess((value) => {
  const parsed = hiddenReasonSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}, hiddenReasonSchema.optional());

/**
 * Known inbox fields only. `z.object` strips unknown keys. A bad value on one
 * field becomes `undefined` so the rest of the payload can still be used.
 */
const payloadSchema = z.object({
  announcement_title: optionalLabel,
  episode_id: optionalResourceId,
  episode_title: optionalLabel,
  hidden_reason: optionalHiddenReason,
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
 * The episode a notification is about, or `undefined` when the payload carries
 * neither title. Quoting and the order of the two titles differ per language,
 * so each shape is its own key rather than a string this module assembles.
 */
const episodeSubject = async (
  locale: Locale,
  payload: NotificationPayload
): Promise<string | undefined> => {
  const t = await getMessagesFor(locale);

  if (payload.episode_title && payload.series_title) {
    return t("host.notifications.episode_subject_with_series", {
      episode_title: payload.episode_title,
      series_title: payload.series_title,
    });
  }
  if (payload.episode_title) {
    return t("host.notifications.episode_subject", {
      episode_title: payload.episode_title,
    });
  }
  if (payload.series_title) {
    return t("host.notifications.episode_subject_series", {
      series_title: payload.series_title,
    });
  }
  return undefined;
};

const isCommentNotification = (notificationType: string): boolean =>
  notificationType === NOTIFICATION_TYPE_COMMENT_APPROVED ||
  notificationType === NOTIFICATION_TYPE_COMMENT_HIDDEN;

/**
 * Where a row takes the reader. A comment type lands on the episode page like
 * every other one: the section is a dialog on the page after the last, so no
 * URL of its own puts a reader in front of it.
 */
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
 * What took the comment down. The reader is told the category rather than the
 * moderator's note, and a payload without one still gets a whole sentence.
 */
const commentHiddenDescription = (
  t: HostMessageAccessor,
  payload: NotificationPayload,
  subject: string
): string => {
  if (payload.hidden_reason === COMMENT_HIDDEN_REASON_STAFF) {
    return t("host.notifications.comment_hidden_description_staff", {
      subject,
    });
  }
  if (payload.hidden_reason === COMMENT_HIDDEN_REASON_AUTO_REPORTS) {
    return t("host.notifications.comment_hidden_description_reports", {
      subject,
    });
  }
  return t("host.notifications.comment_hidden_description", { subject });
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
    // The row links at the inbox rather than at one announcement: there is no
    // per-announcement screen, and the list is where the body and the
    // mark-as-read control are.
    return {
      description: payload.announcement_title
        ? t("host.notifications.announcement_posted_description", {
            title: payload.announcement_title,
          })
        : t("host.notifications.announcement_posted_description_unknown"),
      href: ANNOUNCEMENTS_HREF,
      title: t("host.notifications.announcement_posted_title"),
    };
  }

  if (type === NOTIFICATION_TYPE_EPISODE_PUBLISHED) {
    const subject =
      (await episodeSubject(locale, payload)) ??
      t("host.notifications.episode_published_subject_unknown");

    return {
      description: t("host.notifications.episode_published_description", {
        subject,
      }),
      href,
      title: t("host.notifications.episode_published_title"),
    };
  }

  if (isCommentNotification(type)) {
    const subject =
      (await episodeSubject(locale, payload)) ??
      t("host.notifications.comment_subject_unknown");

    if (type === NOTIFICATION_TYPE_COMMENT_APPROVED) {
      return {
        description: t("host.notifications.comment_approved_description", {
          subject,
        }),
        href,
        title: t("host.notifications.comment_approved_title"),
      };
    }

    return {
      description: commentHiddenDescription(t, payload, subject),
      href,
      title: t("host.notifications.comment_hidden_title"),
    };
  }

  return {
    description: t("host.notifications.unknown_description"),
    href,
    title: t("host.notifications.unknown_title"),
  };
};
