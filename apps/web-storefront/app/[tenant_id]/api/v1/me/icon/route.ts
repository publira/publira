import type { Locale } from "@publira/i18n";
import { sharedRpcErrorMessage } from "@publira/i18n/catalog";
import { NextResponse } from "next/server";
import { z } from "zod";

import { checkAccountIconFile } from "#lib/account-icon";
import type { AccountIconFileProblem } from "#lib/account-icon";
import { deleteMyIcon, uploadMyIcon } from "#lib/auth";
import type { IconChangeOutcome } from "#lib/auth";
import { tenantIdSchema } from "#lib/auth-input";
import { isSameOriginRequest } from "#lib/csrf";
import { localeFormSchema } from "#lib/locale-form";
import { getMessagesFor } from "#lib/messages";
import type { StorefrontMessageKey } from "#lib/messages";

const pathSchema = z.object({ tenantId: tenantIdSchema });

const searchSchema = z.object({ locale: localeFormSchema });

/** What the settings screen shows: the outcome in the reader's language. */
export interface AccountIconResponse {
  message: string;
}

const FILE_PROBLEM_MESSAGES: Record<
  AccountIconFileProblem,
  StorefrontMessageKey
> = {
  "too-large": "storefront.settings.icon_too_large",
  "too-small": "storefront.settings.icon_too_small",
  unsupported: "storefront.settings.icon_unsupported",
};

const REFUSAL_STATUS: Partial<
  Record<Extract<IconChangeOutcome, { ok: false }>["refusal"], number>
> = {
  "rate-limited": 429,
  "storage-not-configured": 503,
  unauthenticated: 401,
  unavailable: 503,
};

const respond = (message: string, status = 200) =>
  NextResponse.json<AccountIconResponse>({ message }, { status });

/**
 * The tenant from the path and the locale from the query, or the response
 * that refuses the request. Neither is chosen by the reader: the proxy writes
 * the tenant and the settings screen the locale it is rendered in.
 */
const readRequest = async (
  request: Request,
  params: Promise<{ tenant_id: string }>
): Promise<{ locale: Locale; tenantId: string } | { refused: Response }> => {
  if (!isSameOriginRequest(request.headers)) {
    return { refused: new NextResponse(null, { status: 403 }) };
  }

  const { tenant_id } = await params;
  const path = pathSchema.safeParse({ tenantId: tenant_id });
  const search = searchSchema.safeParse({
    locale: new URL(request.url).searchParams.get("locale"),
  });
  if (!path.success || !search.success) {
    return { refused: new NextResponse(null, { status: 400 }) };
  }

  return { locale: search.data.locale, tenantId: path.data.tenantId };
};

/** The response for what the API made of the change. */
const respondToOutcome = async (
  outcome: IconChangeOutcome,
  locale: Locale,
  messages: { done: StorefrontMessageKey; failed: StorefrontMessageKey }
): Promise<Response> => {
  const t = await getMessagesFor(locale);
  if (outcome.ok) {
    return respond(t(messages.done));
  }

  const status = REFUSAL_STATUS[outcome.refusal] ?? 400;
  switch (outcome.refusal) {
    case "image": {
      return respond(t("storefront.settings.icon_refused"), status);
    }
    case "storage-not-configured": {
      return respond(t("storefront.settings.icon_storage_unavailable"), status);
    }
    default: {
      return respond(
        sharedRpcErrorMessage(outcome.refusal, locale) ?? t(messages.failed),
        status
      );
    }
  }
};

const uploadFormSchema = z.object({ icon: z.instanceof(File) });

/**
 * Sets the signed-in reader's icon from the `icon` file of a multipart body.
 *
 * A Route Handler rather than a Server Action because of the body: an icon may
 * be 10 MiB, and `/api/v1…` is the one path every edge admits a body that
 * large on for the site's own app, while a Server Action posts to the page's
 * path, which nginx holds to its 1 MB default.
 *
 * The same-origin check is what keeps another site from changing the icon of a
 * reader who is signed in here.
 */
export const POST = async (
  request: Request,
  { params }: RouteContext<"/[tenant_id]/api/v1/me/icon">
) => {
  const read = await readRequest(request, params);
  if ("refused" in read) {
    return read.refused;
  }
  const { locale, tenantId } = read;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const form = uploadFormSchema.safeParse({ icon: formData.get("icon") });
  if (!form.success) {
    return new NextResponse(null, { status: 400 });
  }
  const { icon } = form.data;

  // The screen has already checked the file, so this answers a request that
  // did not come from it, before the bytes are sent on to the API.
  const problem = checkAccountIconFile(icon);
  if (problem) {
    const t = await getMessagesFor(locale);
    return respond(t(FILE_PROBLEM_MESSAGES[problem]), 400);
  }

  const outcome = await uploadMyIcon(tenantId, {
    contentType: icon.type,
    data: new Uint8Array(await icon.arrayBuffer()),
  });
  return respondToOutcome(outcome, locale, {
    done: "storefront.settings.icon_uploaded",
    failed: "storefront.settings.icon_upload_failed",
  });
};

/** Leaves the signed-in reader's account with no icon. */
export const DELETE = async (
  request: Request,
  { params }: RouteContext<"/[tenant_id]/api/v1/me/icon">
) => {
  const read = await readRequest(request, params);
  if ("refused" in read) {
    return read.refused;
  }
  const { locale, tenantId } = read;

  const outcome = await deleteMyIcon(tenantId);
  return respondToOutcome(outcome, locale, {
    done: "storefront.settings.icon_removed",
    failed: "storefront.settings.icon_remove_failed",
  });
};
