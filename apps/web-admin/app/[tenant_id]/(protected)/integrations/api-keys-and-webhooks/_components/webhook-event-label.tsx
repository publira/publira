import { Message } from "#components/message";
import type { WebhookDeliveryEventValue } from "#lib/webhooks";

/**
 * An event's name, worded one branch at a time so each key stays where
 * anything reading this file for the screen's strings can see it. The name a
 * receiver reads in `type` is shown beside it by the caller where it helps.
 */
export const WebhookEventLabel = ({
  eventType,
}: {
  eventType: WebhookDeliveryEventValue;
}) => {
  switch (eventType) {
    case "purchase.completed": {
      return (
        <Message message="admin.settings.webhooks.events.purchase_completed" />
      );
    }

    case "purchase.refunded": {
      return (
        <Message message="admin.settings.webhooks.events.purchase_refunded" />
      );
    }

    case "reader.signed_up": {
      return (
        <Message message="admin.settings.webhooks.events.reader_signed_up" />
      );
    }

    case "subscription.started": {
      return (
        <Message message="admin.settings.webhooks.events.subscription_started" />
      );
    }

    case "subscription.ended": {
      return (
        <Message message="admin.settings.webhooks.events.subscription_ended" />
      );
    }

    case "episode.published": {
      return (
        <Message message="admin.settings.webhooks.events.episode_published" />
      );
    }

    case "episode.unpublished": {
      return (
        <Message message="admin.settings.webhooks.events.episode_unpublished" />
      );
    }

    case "comment.posted": {
      return (
        <Message message="admin.settings.webhooks.events.comment_posted" />
      );
    }

    case "webhook.test": {
      return <Message message="admin.settings.webhooks.events.test" />;
    }

    default: {
      return null;
    }
  }
};

/** What an event is sent for, worded the same way. */
export const WebhookEventDescription = ({
  eventType,
}: {
  eventType: WebhookDeliveryEventValue;
}) => {
  switch (eventType) {
    case "purchase.completed": {
      return (
        <Message message="admin.settings.webhooks.events.purchase_completed_description" />
      );
    }

    case "purchase.refunded": {
      return (
        <Message message="admin.settings.webhooks.events.purchase_refunded_description" />
      );
    }

    case "reader.signed_up": {
      return (
        <Message message="admin.settings.webhooks.events.reader_signed_up_description" />
      );
    }

    case "subscription.started": {
      return (
        <Message message="admin.settings.webhooks.events.subscription_started_description" />
      );
    }

    case "subscription.ended": {
      return (
        <Message message="admin.settings.webhooks.events.subscription_ended_description" />
      );
    }

    case "episode.published": {
      return (
        <Message message="admin.settings.webhooks.events.episode_published_description" />
      );
    }

    case "episode.unpublished": {
      return (
        <Message message="admin.settings.webhooks.events.episode_unpublished_description" />
      );
    }

    case "comment.posted": {
      return (
        <Message message="admin.settings.webhooks.events.comment_posted_description" />
      );
    }

    default: {
      return null;
    }
  }
};
