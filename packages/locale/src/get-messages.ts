import { bindMessages } from "@publira/i18n";
import type { Locale, MessageAccessor, MessageTree } from "@publira/i18n";

/**
 * `getMessages()` for one app: the locale `getLocale` resolves, then that
 * app's catalog bound to it. `load` is the app's full catalog, not the client
 * namespace. Pass the app's `getLocale`, the one from
 * `@publira/locale/root-locale`.
 */
export const createGetMessages = <TCatalog extends MessageTree>(
  load: (locale: Locale) => Promise<TCatalog>,
  getLocale: () => Promise<Locale>
): (() => Promise<MessageAccessor<TCatalog>>) =>
  async function getMessages(): Promise<MessageAccessor<TCatalog>> {
    const locale = await getLocale();

    return bindMessages(await load(locale), locale);
  };
