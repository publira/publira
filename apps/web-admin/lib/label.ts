import type { Label } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import { forEachPageWithToken } from "@publira/api-client/pagination";
import { getMessage, toIntlLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cacheTag } from "next/cache";
import { z } from "zod";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CursorPageOptions, CursorPageTokens } from "./cursor-page";
import {
  cursorPageRequest,
  cursorPageTokens,
  emptyCursorPageTokens,
} from "./cursor-page";
import { FALLBACK_LOCALE } from "./fallback-locale";
import { mentionsImageRejection } from "./image-rejection";
import { getAccessToken } from "./session";

export interface LabelItem {
  publicId: string;
  name: string;
  eyeCatchImageUpdatedAt: string;
  eyeCatchImageVariants: {
    variantType: string;
    label: string;
    url: string;
    contentType: string;
    width: number;
    height: number;
    fileSizeBytes: number;
  }[];
}

export type ListLabelsResult = CursorPageTokens &
  (
    | { ok: true; labels: LabelItem[] }
    | {
        ok: false;
        message: string;
        labels: LabelItem[];
        /** The API rejected the session — the page raises the login redirect. */
        requiresSignIn: boolean;
      }
  );

export type CreateLabelResult =
  | { ok: true; label: LabelItem }
  | { ok: false; message: string };

export type UpdateLabelResult =
  | { ok: true; label: LabelItem }
  | { ok: false; message: string };

/**
 * `notFound: true` is the "there is nothing to show here" failure the edit
 * screen turns into `notFound()`. It carries no message: the screen is replaced
 * by `not-found.tsx`, and wording that distinguished a missing label from
 * another tenant's label would leak whether it exists.
 *
 * The flag exists because `getLabel()` runs inside a `"use cache: private"`
 * scope, where a thrown `notFound()` is not observable by the caller (#672).
 * The interrupt has to be raised by the caller, outside the cache scope.
 */
export type GetLabelResult =
  | { ok: true; label: LabelItem }
  | { notFound: true; ok: false }
  | {
      message: string;
      notFound?: false;
      ok: false;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn?: boolean;
    };

const sessionErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "errors.rpc.unauthenticated");
const listErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.labels.list_failed");
const mutationErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.labels.save_failed");

const invalidArgumentMessage = (
  error: unknown,
  messages: SharedMessages
): string =>
  mentionsImageRejection(error)
    ? getMessage(messages, "admin.labels.image_invalid")
    : getMessage(messages, "errors.rpc.invalid-argument");

const mapErrorToMessage = (
  error: unknown,
  fallbackMessage: string,
  locale: Locale
): string =>
  rpcErrorMessage(error, fallbackMessage, {
    locale,
    overrides: {
      "invalid-argument": invalidArgumentMessage(error, sharedCatalog(locale)),
    },
  });

/** The generated `Label` fields {@link mapLabel} reads (see `series.ts`). */
type RawLabel = Pick<
  Label,
  "eyeCatchImageUpdatedAt" | "eyeCatchImageVariants" | "name" | "publicId"
>;

const mapLabel = (label: RawLabel): LabelItem => ({
  eyeCatchImageUpdatedAt: label.eyeCatchImageUpdatedAt ?? "",
  eyeCatchImageVariants: (label.eyeCatchImageVariants ?? []).flatMap(
    (variant) => {
      const mappedVariant = {
        contentType: variant.contentType ?? "",
        fileSizeBytes: Number(variant.fileSizeBytes ?? 0),
        height: variant.height ?? 0,
        label: variant.label ?? "",
        url: variant.url ?? "",
        variantType: variant.variantType ?? "",
        width: variant.width ?? 0,
      };
      return mappedVariant.label.length > 0 && mappedVariant.url.length > 0
        ? [mappedVariant]
        : [];
    }
  ),
  name: label.name,
  publicId: label.publicId,
});

/**
 * One page of the tenant's labels, newest first.
 *
 * The rows keep the server's keyset order (`created_at`, `id` descending).
 * Sorting them here would only sort the rows that happen to share a page, which
 * reads as a broken order as soon as the list spans more than one page.
 */
export const listLabels = async (
  tenantId: string,
  options: CursorPageOptions = {},
  locale: Locale = FALLBACK_LOCALE
): Promise<ListLabelsResult> => {
  "use cache: private";
  cacheTag(`labels-${tenantId}`);

  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      labels: [],
      message: sessionErrorMessage(messages),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.label.listLabels(
      {
        ...cursorPageRequest(options),
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ...cursorPageTokens(response),
      labels: (response.labels ?? []).map((item) => mapLabel(item)),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      ...emptyCursorPageTokens,
      labels: [],
      message: mapErrorToMessage(error, listErrorMessage(messages), locale),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

/**
 * Every label in the tenant for combobox pickers (series form, etc.).
 *
 * Walks `ListLabels` cursor pages so the client-side Combobox can search
 * beyond a single RPC page. The `/labels` list keeps {@link listLabels}
 * (one page) so list paging stays independent of picker loading.
 *
 * Sorted by name for readable search results. An incomplete walk (budget
 * exhausted or a repeated token) fails with an empty list rather than a
 * partial option set that would hide labels beyond the rows already read.
 */
export const listAllLabels = async (
  tenantId: string,
  locale: Locale = FALLBACK_LOCALE
): Promise<ListLabelsResult> => {
  "use cache: private";
  cacheTag(`labels-${tenantId}`);

  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      labels: [],
      message: sessionErrorMessage(messages),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const labels: LabelItem[] = [];
    const walkStop = await forEachPageWithToken(
      async (token, limit) => {
        const response = await apiClient.label.listLabels(
          {
            limit,
            tenant: { tenantId },
            token,
          },
          withSessionHeaders(sessionId)
        );
        return {
          items: response.labels ?? [],
          nextToken: response.nextToken ?? "",
        };
      },
      (items) => {
        for (const item of items) {
          labels.push(mapLabel(item));
        }
      }
    );

    // Match listAllCreators / episode reorder: never hand the form a partial
    // option list that looks complete.
    if (walkStop !== "completed") {
      return {
        ...emptyCursorPageTokens,
        labels: [],
        message: listErrorMessage(messages),
        ok: false,
        requiresSignIn: false,
      };
    }

    return {
      ...emptyCursorPageTokens,
      labels: labels.toSorted((a, b) =>
        a.name.localeCompare(b.name, toIntlLocale(locale))
      ),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      ...emptyCursorPageTokens,
      labels: [],
      message: mapErrorToMessage(error, listErrorMessage(messages), locale),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const createLabel = async (
  input: {
    tenantId: string;
    name: string;
    eyeCatchImageContentType?: string;
    eyeCatchImageData?: Uint8Array;
  },
  locale: Locale = FALLBACK_LOCALE
): Promise<CreateLabelResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
      ok: false,
    };
  }

  try {
    const response = await apiClient.label.createLabel(
      {
        eyeCatchImageContentType: input.eyeCatchImageContentType,
        eyeCatchImageData: input.eyeCatchImageData,
        name: input.name,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.label?.publicId?.trim()) {
      return {
        message: mutationErrorMessage(messages),
        ok: false,
      };
    }

    return {
      label: mapLabel(response.label),
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, mutationErrorMessage(messages), locale),
      ok: false,
    };
  }
};

export const updateLabel = async (
  input: {
    tenantId: string;
    publicId: string;
    name: string;
    clearEyeCatchImage?: boolean;
    eyeCatchImageContentType?: string;
    eyeCatchImageData?: Uint8Array;
  },
  locale: Locale = FALLBACK_LOCALE
): Promise<UpdateLabelResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
      ok: false,
    };
  }

  try {
    const response = await apiClient.label.updateLabel(
      {
        clearEyeCatchImage: input.clearEyeCatchImage,
        eyeCatchImageContentType: input.eyeCatchImageContentType,
        eyeCatchImageData: input.eyeCatchImageData,
        name: input.name,
        publicId: input.publicId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.label?.publicId?.trim()) {
      return {
        message: mutationErrorMessage(messages),
        ok: false,
      };
    }

    return {
      label: mapLabel(response.label),
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, mutationErrorMessage(messages), locale),
      ok: false,
    };
  }
};

const getLabelInputSchema = z.object({
  publicId: z.string().trim().min(1).max(255),
  tenantId: z.string().trim().min(1).max(255),
});

export const getLabel = async (
  input: {
    tenantId: string;
    publicId: string;
  },
  locale: Locale = FALLBACK_LOCALE
): Promise<GetLabelResult> => {
  "use cache: private";
  const parsed = getLabelInputSchema.safeParse(input);
  if (!parsed.success) {
    // Same notFound as a missing / other-tenant label: the URL is not a
    // resource, and wording that said "malformed" would only help an
    // attacker probe which strings the server accepts.
    return { notFound: true, ok: false };
  }

  cacheTag(`labels-${parsed.data.tenantId}`);
  cacheTag(`label-${parsed.data.tenantId}-${parsed.data.publicId}`);

  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.label.getLabel(
      {
        publicId: parsed.data.publicId,
        tenant: { tenantId: parsed.data.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.label?.publicId?.trim()) {
      return {
        message: listErrorMessage(messages),
        ok: false,
      };
    }

    return {
      label: mapLabel(response.label),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    if (isMissingResourceRpcError(error)) {
      return { notFound: true, ok: false };
    }
    return {
      message: mapErrorToMessage(error, listErrorMessage(messages), locale),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};
