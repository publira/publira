import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";

import {
  apiClient,
  buildClientAddressHeaders,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { getMessagesFor } from "./messages";

export interface ContactMessageInput {
  body: string;
  locale: Locale;
  replyToEmail: string;
  /** Empty when the reader gave none. */
  subject: string;
  tenantId: string;
}

export type SubmitContactMessageResult =
  | { ok: true }
  | { message: string; ok: false };

/**
 * Send one message to the tenant's staff.
 *
 * The session goes along when there is one, so staff can tell a question about
 * an account from one about the site, and a guest sends without one. A session
 * the API no longer accepts does not stop the message either: the API sends it
 * as a guest's rather than asking a reader who may be unable to sign in to do
 * so first.
 */
export const submitContactMessage = async (
  input: ContactMessageInput
): Promise<SubmitContactMessageResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(input.locale),
    resolveAccessToken(),
  ]);
  const callOptions = sessionId
    ? buildSessionHeaders(sessionId)
    : await buildClientAddressHeaders();

  try {
    await apiClient.contact.submitContactMessage(
      {
        body: input.body,
        replyToEmail: input.replyToEmail,
        subject: input.subject,
        tenant: { tenantId: input.tenantId },
      },
      callOptions
    );
    return { ok: true };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, t("host.contact.submit_failed"), {
        locale: input.locale,
      }),
      ok: false,
    };
  }
};
