import { getLocale } from "#lib/locale";
import { tenantLocaleUrl } from "#lib/tenant-locale-path";

import { ShareMenu } from "./share-menu";

/**
 * The share control, with the address it hands over already resolved.
 *
 * The URL is built here rather than in the browser because the reader is not
 * the only one who has to agree on it: the canonical address is the tenant's
 * own domain and the locale the route names, and `window.location` reports
 * whatever host and query string this particular visit arrived on.
 *
 * A tenant whose origin cannot be read renders no control at all. Sharing is
 * chrome beside the work rather than part of it, and a button that would hand
 * over an address nobody can open is worse than one that is briefly missing.
 */
export const ShareControl = async ({
  path,
  tenantId,
  title,
}: {
  /** App-internal path without the locale prefix, e.g. `/series/SR01`. */
  path: string;
  tenantId: string;
  /** The work or episode being passed on, which the share text names. */
  title: string;
}) => {
  const locale = await getLocale();
  const url = await tenantLocaleUrl(tenantId, locale, path);

  if (!url) {
    return null;
  }

  return <ShareMenu title={title} url={url} />;
};
