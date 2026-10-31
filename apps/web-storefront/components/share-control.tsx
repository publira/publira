import Image from "next/image";

import { getLocale } from "#lib/locale";
import { getTenantSiteInfo } from "#lib/tenant";
import type { TenantImageVariant } from "#lib/tenant";
import { resolveTenantBrandMarkVariant } from "#lib/tenant-brand-mark";
import { tenantLocaleUrl } from "#lib/tenant-locale-path";

import { ShareMenu } from "./share-menu";

/**
 * A service's mark at the head of its row. The row's label already names the
 * service, so the mark is decoration and has no text of its own.
 */
const ShareMark = ({ variant }: { variant: TenantImageVariant }) => (
  <Image
    alt=""
    className="size-full object-contain"
    height={variant.height}
    sizes="16px"
    src={variant.url}
    width={variant.width}
  />
);

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
 *
 * The X and LINE marks are the ones the tenant uploaded, read here so that the
 * menu itself stays a client component with nothing to fetch.
 */
export const ShareControl = async ({
  path,
  tenantId,
  text,
  title,
}: {
  /** App-internal path without the locale prefix, e.g. `/series/SR01`. */
  path: string;
  tenantId: string;
  /**
   * The message the share carries, worded by the caller — see `lib/share-text.ts`
   * for the one every screen uses today.
   */
  text: string;
  /** What this page is called: the trigger's accessible name, and nothing else. */
  title: string;
}) => {
  const locale = await getLocale();

  const [url, tenant] = await Promise.all([
    tenantLocaleUrl(tenantId, locale, path),
    getTenantSiteInfo(tenantId),
  ]);

  if (!url) {
    return null;
  }

  const xMark = resolveTenantBrandMarkVariant(tenant, "x_share");
  const lineMark = resolveTenantBrandMarkVariant(tenant, "line_share");

  return (
    <ShareMenu
      lineMark={lineMark ? <ShareMark variant={lineMark} /> : undefined}
      text={text}
      title={title}
      url={url}
      xMark={xMark ? <ShareMark variant={xMark} /> : undefined}
    />
  );
};
