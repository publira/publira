import type {
  WebhookDelivery,
  WebhookEndpoint,
} from "@publira/api-client/admin/types";
import {
  WebhookDeliveryStatus,
  WebhookEventType,
} from "@publira/api-client/admin/webhook";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  RPC_ERROR_REASON,
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
  rpcErrorHasFieldViolation,
  rpcErrorHasReason,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheLife, cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CachedRead } from "./cached-read";
import { settleCachedRead } from "./cached-read";
import type { CursorPageOptions, CursorPageTokens } from "./cursor-page";
import {
  cursorPageRequest,
  cursorPageTokens,
  emptyCursorPageTokens,
} from "./cursor-page";
import type { AdminMessageAccessor } from "./messages";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";

/** How many endpoints a tenant keeps at most; the server refuses a sixth. */
export const MAX_WEBHOOK_ENDPOINTS = 5;

/** The events an endpoint can subscribe to, by the name a body carries. */
export const WEBHOOK_EVENT_TYPES = [
  "purchase.completed",
  "purchase.refunded",
  "reader.signed_up",
  "subscription.started",
  "subscription.ended",
  "episode.published",
  "episode.unpublished",
] as const;

export type WebhookEventTypeValue = (typeof WEBHOOK_EVENT_TYPES)[number];

/** What a delivery can be of: a subscribed event, or what a test sends. */
export type WebhookDeliveryEventValue = WebhookEventTypeValue | "webhook.test";

export const WEBHOOK_DELIVERY_STATUSES = [
  "pending",
  "failed",
  "delivered",
  "dead",
] as const;

export type WebhookDeliveryStatusValue =
  (typeof WEBHOOK_DELIVERY_STATUSES)[number];

const eventValues: Partial<
  Record<WebhookEventType, WebhookDeliveryEventValue>
> = {
  [WebhookEventType.EPISODE_PUBLISHED]: "episode.published",
  [WebhookEventType.EPISODE_UNPUBLISHED]: "episode.unpublished",
  [WebhookEventType.PURCHASE_COMPLETED]: "purchase.completed",
  [WebhookEventType.PURCHASE_REFUNDED]: "purchase.refunded",
  [WebhookEventType.READER_SIGNED_UP]: "reader.signed_up",
  [WebhookEventType.SUBSCRIPTION_ENDED]: "subscription.ended",
  [WebhookEventType.SUBSCRIPTION_STARTED]: "subscription.started",
  [WebhookEventType.TEST]: "webhook.test",
};

const rpcEventTypes: Record<WebhookEventTypeValue, WebhookEventType> = {
  "episode.published": WebhookEventType.EPISODE_PUBLISHED,
  "episode.unpublished": WebhookEventType.EPISODE_UNPUBLISHED,
  "purchase.completed": WebhookEventType.PURCHASE_COMPLETED,
  "purchase.refunded": WebhookEventType.PURCHASE_REFUNDED,
  "reader.signed_up": WebhookEventType.READER_SIGNED_UP,
  "subscription.ended": WebhookEventType.SUBSCRIPTION_ENDED,
  "subscription.started": WebhookEventType.SUBSCRIPTION_STARTED,
};

const statusValues: Partial<
  Record<WebhookDeliveryStatus, WebhookDeliveryStatusValue>
> = {
  [WebhookDeliveryStatus.DEAD]: "dead",
  [WebhookDeliveryStatus.DELIVERED]: "delivered",
  [WebhookDeliveryStatus.FAILED]: "failed",
  [WebhookDeliveryStatus.PENDING]: "pending",
};

const rpcStatuses: Record<WebhookDeliveryStatusValue, WebhookDeliveryStatus> = {
  dead: WebhookDeliveryStatus.DEAD,
  delivered: WebhookDeliveryStatus.DELIVERED,
  failed: WebhookDeliveryStatus.FAILED,
  pending: WebhookDeliveryStatus.PENDING,
};

const isSubscribableEvent = (
  value: WebhookDeliveryEventValue
): value is WebhookEventTypeValue => value !== "webhook.test";

/** What the console shows of an endpoint: its secret only as a hint. */
export interface WebhookEndpointItem {
  createdAt: string;
  enabled: boolean;
  eventTypes: WebhookEventTypeValue[];
  id: string;
  /** The secret's start and its last four characters. */
  secretHint: string;
  updatedAt: string;
  url: string;
}

export interface WebhookDeliveryItem {
  attempts: number;
  createdAt: string;
  /** RFC 3339; empty until delivered. */
  deliveredAt: string;
  endpointId: string;
  endpointUrl: string;
  /** `null` for an event a newer server sends that this console has no word for. */
  eventType: WebhookDeliveryEventValue | null;
  id: string;
  /** Why the last attempt failed; empty once delivered. */
  lastError: string;
  /** The HTTP status of the last answer; 0 when the last attempt got none. */
  lastStatusCode: number;
  status: WebhookDeliveryStatusValue | null;
  updatedAt: string;
}

export type ListWebhookEndpointsResult =
  | { endpoints: WebhookEndpointItem[]; ok: true }
  | {
      endpoints: WebhookEndpointItem[];
      message: string;
      ok: false;
      requiresSignIn?: boolean;
    };

export type ListWebhookDeliveriesResult = CursorPageTokens &
  (
    | { deliveries: WebhookDeliveryItem[]; ok: true }
    | {
        deliveries: WebhookDeliveryItem[];
        message: string;
        ok: false;
        requiresSignIn?: boolean;
      }
  );

export interface WebhookFailure {
  message: string;
  ok: false;
}

export type SaveWebhookEndpointResult =
  | { endpoint: WebhookEndpointItem; ok: true }
  | WebhookFailure;

/** An endpoint created or rotated, with the secret answered this once. */
export type WebhookSecretResult =
  | { endpoint: WebhookEndpointItem; ok: true; secret: string }
  | WebhookFailure;

export type WebhookDeliveryResult =
  | { delivery: WebhookDeliveryItem; ok: true }
  | WebhookFailure;

export type DeleteWebhookEndpointResult = { ok: true } | WebhookFailure;

/** The tag the endpoint list carries; only this console changes it. */
export const webhookEndpointsCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:webhook-endpoints`;

/**
 * The tag the delivery list carries. The worker moves a delivery on without
 * this console, so the list also declares `cacheLife("minutes")`.
 */
export const webhookDeliveriesCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:webhook-deliveries`;

type RawWebhookEndpoint = Pick<
  WebhookEndpoint,
  | "createdAt"
  | "enabled"
  | "eventTypes"
  | "id"
  | "secretHint"
  | "updatedAt"
  | "url"
>;

type RawWebhookDelivery = Pick<
  WebhookDelivery,
  | "attempts"
  | "createdAt"
  | "deliveredAt"
  | "endpointId"
  | "endpointUrl"
  | "eventType"
  | "id"
  | "lastError"
  | "lastStatusCode"
  | "status"
  | "updatedAt"
>;

const toWebhookEndpointItem = (
  endpoint: RawWebhookEndpoint
): WebhookEndpointItem => ({
  createdAt: endpoint.createdAt ?? "",
  enabled: endpoint.enabled ?? false,
  eventTypes: (endpoint.eventTypes ?? []).flatMap((eventType) => {
    const value = eventValues[eventType];

    return value && isSubscribableEvent(value) ? [value] : [];
  }),
  id: endpoint.id ?? "",
  secretHint: endpoint.secretHint ?? "",
  updatedAt: endpoint.updatedAt ?? "",
  url: endpoint.url ?? "",
});

const toWebhookDeliveryItem = (
  delivery: RawWebhookDelivery
): WebhookDeliveryItem => ({
  attempts: delivery.attempts ?? 0,
  createdAt: delivery.createdAt ?? "",
  deliveredAt: delivery.deliveredAt ?? "",
  endpointId: delivery.endpointId ?? "",
  endpointUrl: delivery.endpointUrl ?? "",
  eventType: eventValues[delivery.eventType] ?? null,
  id: delivery.id ?? "",
  lastError: delivery.lastError ?? "",
  lastStatusCode: delivery.lastStatusCode ?? 0,
  status: statusValues[delivery.status] ?? null,
  updatedAt: delivery.updatedAt ?? "",
});

/** Who is asking, and for which tenant; empty values sign the caller out. */
const resolveCaller = async (tenantId: string, locale: Locale) => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  return { normalizedTenantId: tenantId.trim(), sessionId, t };
};

const listWebhookEndpointsForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<CachedRead<ListWebhookEndpointsResult>> => {
  "use cache: private";

  const t = await getMessagesFor(locale);
  const normalizedTenantId = tenantId.trim();

  if (!normalizedTenantId || !sessionId) {
    dropFailedCacheEntry();

    return {
      endpoints: [],
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: !sessionId,
    };
  }

  cacheTag(webhookEndpointsCacheTag(normalizedTenantId));

  try {
    const response = await apiClient.webhooks.listWebhookEndpoints(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    return {
      endpoints: response.endpoints.map(toWebhookEndpointItem),
      ok: true,
    };
  } catch (error) {
    dropFailedCacheEntry();

    return {
      endpoints: [],
      message: rpcErrorMessage(
        error,
        t("admin.settings.webhooks.load_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

/** Every endpoint of the tenant's, oldest first. */
export const listWebhookEndpoints = async (
  tenantId: string,
  locale: Locale
): Promise<ListWebhookEndpointsResult> =>
  settleCachedRead(
    await listWebhookEndpointsForSession(
      tenantId,
      locale,
      await getAccessToken()
    )
  );

export interface ListWebhookDeliveriesOptions extends CursorPageOptions {
  /** Only deliveries in this status; omitted for every delivery. */
  status?: WebhookDeliveryStatusValue;
}

const listWebhookDeliveriesForSession = async (
  tenantId: string,
  locale: Locale,
  options: ListWebhookDeliveriesOptions,
  sessionId: string
): Promise<CachedRead<ListWebhookDeliveriesResult>> => {
  "use cache: private";

  const t = await getMessagesFor(locale);
  const normalizedTenantId = tenantId.trim();

  if (!normalizedTenantId || !sessionId) {
    dropFailedCacheEntry();

    return {
      ...emptyCursorPageTokens,
      deliveries: [],
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: !sessionId,
    };
  }

  cacheTag(webhookDeliveriesCacheTag(normalizedTenantId));
  cacheLife("minutes");

  try {
    const response = await apiClient.webhooks.listWebhookDeliveries(
      {
        ...cursorPageRequest(options),
        status: options.status
          ? rpcStatuses[options.status]
          : WebhookDeliveryStatus.UNSPECIFIED,
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ...cursorPageTokens(response),
      deliveries: response.deliveries.map(toWebhookDeliveryItem),
      ok: true,
    };
  } catch (error) {
    dropFailedCacheEntry();

    return {
      ...emptyCursorPageTokens,
      deliveries: [],
      message: rpcErrorMessage(
        error,
        t("admin.settings.webhooks.deliveries.load_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

/** One page of the tenant's deliveries, newest first. */
export const listWebhookDeliveries = async (
  tenantId: string,
  locale: Locale,
  options: ListWebhookDeliveriesOptions = {}
): Promise<ListWebhookDeliveriesResult> =>
  settleCachedRead(
    await listWebhookDeliveriesForSession(
      tenantId,
      locale,
      options,
      await getAccessToken()
    )
  );

export interface WebhookEndpointInput {
  enabled: boolean;
  eventTypes: readonly WebhookEventTypeValue[];
  tenantId: string;
  url: string;
}

/** The wording of an `invalid_argument`, by the field the server names. */
const endpointInvalidArgument = (
  cause: unknown,
  t: AdminMessageAccessor
): string => {
  if (rpcErrorHasFieldViolation(cause, "url")) {
    return t("admin.settings.webhooks.validation.url_https");
  }

  if (rpcErrorHasFieldViolation(cause, "event_types")) {
    return t("admin.settings.webhooks.validation.events_required");
  }

  return t("admin.settings.webhooks.validation.invalid");
};

/** Saves a new endpoint and answers its signing secret, this once. */
export const createWebhookEndpoint = async (
  input: WebhookEndpointInput,
  locale: Locale
): Promise<WebhookSecretResult> => {
  const { normalizedTenantId, sessionId, t } = await resolveCaller(
    input.tenantId,
    locale
  );

  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.webhooks.createWebhookEndpoint(
      {
        enabled: input.enabled,
        eventTypes: input.eventTypes.map((value) => rpcEventTypes[value]),
        tenant: { tenantId: normalizedTenantId },
        url: input.url,
      },
      withSessionHeaders(sessionId)
    );

    if (!response.endpoint || !response.secret) {
      return {
        message: t("admin.settings.webhooks.create_failed"),
        ok: false,
      };
    }

    return {
      endpoint: toWebhookEndpointItem(response.endpoint),
      ok: true,
      secret: response.secret,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.webhooks.create_failed"),
        {
          locale,
          overrides: {
            "invalid-argument": endpointInvalidArgument(error, t),
            precondition: rpcErrorHasReason(
              error,
              RPC_ERROR_REASON.webhookEndpointLimit
            )
              ? t("admin.settings.webhooks.limit_reached", {
                  count: MAX_WEBHOOK_ENDPOINTS,
                })
              : t("admin.settings.webhooks.encryption_unavailable"),
          },
        }
      ),
      ok: false,
    };
  }
};

/** Replaces an endpoint's URL, events, and whether it is enabled. */
export const updateWebhookEndpoint = async (
  endpointId: string,
  input: WebhookEndpointInput,
  locale: Locale
): Promise<SaveWebhookEndpointResult> => {
  const { normalizedTenantId, sessionId, t } = await resolveCaller(
    input.tenantId,
    locale
  );

  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.webhooks.updateWebhookEndpoint(
      {
        enabled: input.enabled,
        endpointId,
        eventTypes: input.eventTypes.map((value) => rpcEventTypes[value]),
        tenant: { tenantId: normalizedTenantId },
        url: input.url,
      },
      withSessionHeaders(sessionId)
    );

    if (!response.endpoint) {
      return { message: t("admin.settings.webhooks.save_failed"), ok: false };
    }

    return { endpoint: toWebhookEndpointItem(response.endpoint), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.webhooks.save_failed"),
        {
          locale,
          overrides: {
            "invalid-argument": endpointInvalidArgument(error, t),
            "not-found": t("admin.settings.webhooks.already_gone"),
          },
        }
      ),
      ok: false,
    };
  }
};

/** Replaces an endpoint's signing secret and answers the new one, this once. */
export const rotateWebhookSecret = async (
  tenantId: string,
  endpointId: string,
  locale: Locale
): Promise<WebhookSecretResult> => {
  const { normalizedTenantId, sessionId, t } = await resolveCaller(
    tenantId,
    locale
  );

  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.webhooks.rotateWebhookSecret(
      { endpointId, tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    if (!response.endpoint || !response.secret) {
      return {
        message: t("admin.settings.webhooks.rotate_failed"),
        ok: false,
      };
    }

    return {
      endpoint: toWebhookEndpointItem(response.endpoint),
      ok: true,
      secret: response.secret,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.webhooks.rotate_failed"),
        {
          locale,
          overrides: {
            "not-found": t("admin.settings.webhooks.already_gone"),
            precondition: t("admin.settings.webhooks.encryption_unavailable"),
          },
        }
      ),
      ok: false,
    };
  }
};

/** Deletes an endpoint and every delivery owed to it. */
export const deleteWebhookEndpoint = async (
  tenantId: string,
  endpointId: string,
  locale: Locale
): Promise<DeleteWebhookEndpointResult> => {
  const { normalizedTenantId, sessionId, t } = await resolveCaller(
    tenantId,
    locale
  );

  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.webhooks.deleteWebhookEndpoint(
      { endpointId, tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.webhooks.delete_failed"),
        {
          locale,
          overrides: {
            "not-found": t("admin.settings.webhooks.already_gone"),
          },
        }
      ),
      ok: false,
    };
  }
};

/** Owes the endpoint a `webhook.test` event, listed with the other deliveries. */
export const sendTestWebhook = async (
  tenantId: string,
  endpointId: string,
  locale: Locale
): Promise<WebhookDeliveryResult> => {
  const { normalizedTenantId, sessionId, t } = await resolveCaller(
    tenantId,
    locale
  );

  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.webhooks.sendTestWebhook(
      { endpointId, tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    if (!response.delivery) {
      return { message: t("admin.settings.webhooks.test_failed"), ok: false };
    }

    return { delivery: toWebhookDeliveryItem(response.delivery), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.webhooks.test_failed"),
        {
          locale,
          overrides: {
            "not-found": t("admin.settings.webhooks.already_gone"),
          },
        }
      ),
      ok: false,
    };
  }
};

/** Owes a dead delivery again, with a budget of attempts of its own. */
export const resendWebhookDelivery = async (
  tenantId: string,
  deliveryId: string,
  locale: Locale
): Promise<WebhookDeliveryResult> => {
  const { normalizedTenantId, sessionId, t } = await resolveCaller(
    tenantId,
    locale
  );

  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.webhooks.resendWebhookDelivery(
      { deliveryId, tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    if (!response.delivery) {
      return {
        message: t("admin.settings.webhooks.deliveries.resend_failed"),
        ok: false,
      };
    }

    return { delivery: toWebhookDeliveryItem(response.delivery), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.webhooks.deliveries.resend_failed"),
        {
          locale,
          overrides: {
            "not-found": t("admin.settings.webhooks.deliveries.already_gone"),
            precondition: t("admin.settings.webhooks.deliveries.not_dead"),
          },
        }
      ),
      ok: false,
    };
  }
};
