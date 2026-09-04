import { getMessage } from "@publira/i18n";
import type { SharedMessages } from "@publira/i18n/catalog";
import { z } from "zod";

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
  tenant_id: optionalResourceId,
  tenant_name: optionalLabel,
});

export type NotificationPayload = z.output<typeof payloadSchema>;

export interface NotificationDisplay {
  description: string;
  href?: string;
  title: string;
}

/**
 * What the row is about, named as precisely as the payload allows.
 *
 * Each branch is a whole catalog message rather than a fragment the caller
 * joins: quoting, the particle that follows a title, and the word order all
 * differ by language, so a sentence assembled from pieces here would only read
 * correctly in the language the pieces were written for.
 */
const episodeSubject = (
  messages: SharedMessages,
  payload: NotificationPayload
): string => {
  if (payload.episode_title && payload.series_title) {
    return getMessage(
      messages,
      "platform.notifications.events.subject_in_series",
      {
        episode: payload.episode_title,
        series: payload.series_title,
      }
    );
  }
  if (payload.episode_title) {
    return getMessage(
      messages,
      "platform.notifications.events.subject_episode",
      { episode: payload.episode_title }
    );
  }
  if (payload.series_title) {
    return getMessage(
      messages,
      "platform.notifications.events.subject_series",
      { series: payload.series_title }
    );
  }
  return getMessage(messages, "platform.notifications.events.subject_unnamed");
};

/**
 * Platform operators land on the tenant, not a series or episode editor.
 * Those screens live in web-admin.
 */
export const notificationHref = (
  payload: NotificationPayload
): string | undefined => {
  if (payload.tenant_id) {
    return `/tenants/${payload.tenant_id}`;
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
 * The failure sentence, in the two shapes the payload allows. A payload that
 * names the tenant gets its own message rather than a prefix pasted onto the
 * other one, for the reason {@link episodeSubject} gives.
 */
const publishFailedDescription = (
  messages: SharedMessages,
  payload: NotificationPayload
): string => {
  const subject = episodeSubject(messages, payload);
  if (payload.tenant_name) {
    return getMessage(
      messages,
      "platform.notifications.events.publish_failed_description_tenant",
      { subject, tenant: payload.tenant_name }
    );
  }

  return getMessage(
    messages,
    "platform.notifications.events.publish_failed_description",
    { subject }
  );
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

  if (type === NOTIFICATION_TYPE_EPISODE_PUBLISH_FAILED) {
    return {
      description: publishFailedDescription(messages, payload),
      href,
      title: getMessage(
        messages,
        "platform.notifications.events.publish_failed_title"
      ),
    };
  }

  return {
    description: getMessage(
      messages,
      "platform.notifications.events.unknown_description"
    ),
    href,
    title: getMessage(messages, "platform.notifications.events.unknown_title"),
  };
};
