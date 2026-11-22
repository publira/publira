import type { MessageValues } from "@publira/i18n";

export interface MessageProps<TKey extends string> {
  message: TKey;
  values?: MessageValues;
}

/**
 * `<Message>` for one app. `TKey` is that app's message-key union.
 *
 * Loading the catalog is what suspends, so the caller wraps the element in the
 * `<Suspense>` whose fallback stands in for that one string. The key is a type
 * argument rather than inferred from the catalog: inferring it walks
 * `MessageKey` backwards, which the full catalog is too large for.
 */
export const createMessage = <TKey extends string>(
  getMessages: () => Promise<(key: TKey, values?: MessageValues) => string>
): ((props: MessageProps<TKey>) => Promise<string>) =>
  async function Message({
    message,
    values,
  }: MessageProps<TKey>): Promise<string> {
    const t = await getMessages();

    return t(message, values);
  };
