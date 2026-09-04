import { expect } from "@playwright/test";

import { MAILPIT_BASE_URL } from "./urls";

/**
 * Reading the mail the stack sent, through Mailpit's HTTP API.
 *
 * Every confirmation token the API mails is stored as a hash, so the message is
 * the only place the token itself exists. A spec that has to finish one of
 * those round trips waits for the message here and takes the token out of the
 * link in it.
 *
 * The sink is shared by every worker, so the functions below take a recipient
 * address: a suite owns its addresses the way it owns its seeded account, and
 * never reads another suite's mail.
 */

/** A message as Mailpit's list endpoint returns it. Its JSON is PascalCase. */
interface MailpitSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[] | null;
}

/** The same message with its decoded bodies, from the single-message endpoint. */
interface MailpitMessage extends MailpitSummary {
  Text: string;
}

export interface Message {
  id: string;
  subject: string;
  text: string;
}

/**
 * Mailpit prunes to 500 stored messages by default, so a page this size holds
 * every message that can exist for one recipient and no other page has to be
 * fetched.
 */
const MESSAGE_PAGE_LIMIT = 500;
const DEFAULT_TIMEOUT_MS = 20_000;

const mailpitRequest = async (
  path: string,
  init?: RequestInit
): Promise<Response> => {
  const response = await fetch(`${MAILPIT_BASE_URL}${path}`, init);
  if (!response.ok) {
    throw new Error(
      `mailpit ${init?.method ?? "GET"} ${path} failed with ${response.status}`
    );
  }
  return response;
};

const mailpitJson = async <T>(path: string): Promise<T> => {
  const response = await mailpitRequest(path);
  const body = await response.json();
  return body as T;
};

/**
 * Newest first, as Mailpit orders them.
 *
 * The recipient goes into the search query rather than into a filter over the
 * whole mailbox, so the page size bounds one address's mail instead of every
 * worker's. `to:` matches the header rather than the address exactly, so the
 * exact comparison stays here.
 */
const summariesTo = async (recipient: string): Promise<MailpitSummary[]> => {
  const wanted = recipient.trim().toLowerCase();
  const query = new URLSearchParams({
    limit: String(MESSAGE_PAGE_LIMIT),
    query: `to:"${wanted}"`,
  });
  const { messages } = await mailpitJson<{ messages: MailpitSummary[] }>(
    `/api/v1/search?${query.toString()}`
  );
  return messages.filter((message) =>
    (message.To ?? []).some(
      (address) => address.Address.toLowerCase() === wanted
    )
  );
};

/**
 * Delete what is already addressed to `recipient`.
 *
 * A suite that sends to the same address twice would otherwise read the first
 * message back as the second one's and confirm a token that is no longer live.
 */
export const clearMessagesTo = async (recipient: string): Promise<void> => {
  const summaries = await summariesTo(recipient);
  if (summaries.length === 0) {
    return;
  }
  await mailpitRequest("/api/v1/messages", {
    body: JSON.stringify({ IDs: summaries.map((summary) => summary.ID) }),
    headers: { "content-type": "application/json" },
    method: "DELETE",
  });
};

/** The newest message addressed to `recipient`, waiting until one arrives. */
export const waitForMessageTo = async (
  recipient: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Message> => {
  // expect.poll owns the interval and the deadline, so mail that never arrives
  // fails here — naming the address — instead of at an assertion further down.
  await expect
    .poll(
      async () => {
        const summaries = await summariesTo(recipient);
        return summaries.length;
      },
      { message: `no message arrived for ${recipient}`, timeout: timeoutMs }
    )
    .toBeGreaterThan(0);

  const [newest] = await summariesTo(recipient);
  if (!newest) {
    throw new Error(
      `the message for ${recipient} was deleted while it was read`
    );
  }
  const message = await mailpitJson<MailpitMessage>(
    `/api/v1/message/${newest.ID}`
  );
  return { id: message.ID, subject: message.Subject, text: message.Text };
};

const LINK_PATTERN = /https?:\/\/\S+/gu;

/**
 * The `token` query value of the first link in `message` whose path is
 * `pathname`.
 *
 * Matching the path rather than the whole URL keeps this independent of the
 * tenant domain the API builds the link from: that is the seeded `localhost`,
 * not the origin with the port the browser reaches web-host on.
 */
export const tokenFromLink = (message: Message, pathname: string): string => {
  for (const [link] of message.text.matchAll(LINK_PATTERN)) {
    const url = new URL(link);
    if (url.pathname !== pathname) {
      continue;
    }
    const token = url.searchParams.get("token");
    if (token) {
      return token;
    }
  }
  throw new Error(`no ${pathname} link with a token in "${message.subject}"`);
};
