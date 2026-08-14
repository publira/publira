import { z } from "zod";

export const NOTIFICATION_TYPE_EPISODE_PUBLISHED = "episode_published";

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

const quoted = (value: string): string => `「${value}」`;

const episodeSubject = (payload: NotificationPayload): string => {
  if (payload.episode_title && payload.series_title) {
    return `${quoted(payload.episode_title)}（${payload.series_title}）`;
  }
  if (payload.episode_title) {
    return quoted(payload.episode_title);
  }
  if (payload.series_title) {
    return `${quoted(payload.series_title)}のエピソード`;
  }
  return "新しいエピソード";
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
  payload: NotificationPayload
): NotificationDisplay => {
  const href = notificationHref(payload);
  const type = notificationType.trim();

  if (type === NOTIFICATION_TYPE_EPISODE_PUBLISHED) {
    return {
      description: `${episodeSubject(payload)}が公開されました。`,
      href,
      title: "新しいエピソードが公開されました",
    };
  }

  return {
    description: "内容の詳細はありません。",
    href,
    title: "通知",
  };
};
