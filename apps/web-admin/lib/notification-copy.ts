import { z } from "zod";

export const NOTIFICATION_TYPE_EPISODE_PUBLISHED = "episode_published";
export const NOTIFICATION_TYPE_EPISODE_PUBLISH_FAILED =
  "episode_publish_failed";

/**
 * Public IDs that can sit in a path segment. Anything else is dropped so a
 * payload cannot push the inbox onto `//`, query strings, or another origin.
 */
const resourceIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/u);

const readResourceId = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = resourceIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

const readLabel = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export interface NotificationPayload {
  episode_id?: string;
  episode_title?: string;
  series_id?: string;
  series_title?: string;
}

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
  return "予約していたエピソード";
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
    if (!isJsonObject(parsed)) {
      return {};
    }
    const record = parsed;
    const payload: NotificationPayload = {};
    const episodeId = readResourceId(record.episode_id);
    const episodeTitle = readLabel(record.episode_title);
    const seriesId = readResourceId(record.series_id);
    const seriesTitle = readLabel(record.series_title);
    if (episodeId) {
      payload.episode_id = episodeId;
    }
    if (episodeTitle) {
      payload.episode_title = episodeTitle;
    }
    if (seriesId) {
      payload.series_id = seriesId;
    }
    if (seriesTitle) {
      payload.series_title = seriesTitle;
    }
    return payload;
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
      description: `${episodeSubject(payload)}を公開しました。`,
      href,
      title: "エピソードが公開されました",
    };
  }

  if (type === NOTIFICATION_TYPE_EPISODE_PUBLISH_FAILED) {
    return {
      description: `${episodeSubject(payload)}を公開できませんでした。`,
      href,
      title: "エピソードの公開に失敗しました",
    };
  }

  return {
    description: "内容の詳細はありません。",
    href,
    title: "通知",
  };
};
