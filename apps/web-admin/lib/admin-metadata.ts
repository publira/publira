import { getMessage } from "@publira/i18n";
import type { Metadata } from "next";

import { getLocale, loadAdminMessages } from "./locale";
import type { AdminMessageKey } from "./locale";

/** Resolve per-page document titles from the same locale as the UI. */
export const getAdminMetadata = async (
  title: AdminMessageKey
): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, title) };
};
