import type { Thing, WithContext } from "schema-dts";

import { getJsonLdSite, serializeJsonLd } from "#lib/json-ld";
import type { JsonLdSite } from "#lib/json-ld";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import type { HostMessageAccessor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";

/**
 * One schema.org document, as the `<script>` a search engine reads it from.
 *
 * The component resolves the site the document is written against — the
 * tenant's origin, the locales, the catalog for the names a breadcrumb trail
 * shows — so the page around it awaits nothing on its behalf. The caller puts
 * it behind a `<Suspense fallback={null}>` of its own, which keeps the page
 * body from waiting for it, and next to the read `build` describes, outside
 * any gate that withholds the body from a first-time visitor.
 *
 * Nothing is rendered where the tenant's origin is unavailable: a document
 * whose `url` and `@id` cannot be absolute is not written at all.
 *
 * A plain `<script>` rather than `next/script`: the content is data, not code,
 * and nothing loads or runs it.
 */
export const JsonLd = async ({
  build,
}: {
  build: (site: JsonLdSite, t: HostMessageAccessor) => WithContext<Thing>;
}) => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [site, t] = await Promise.all([
    getJsonLdSite(tenantId, locale),
    getMessagesFor(locale),
  ]);
  if (!site) {
    return null;
  }

  return (
    <script
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(build(site, t)) }}
      type="application/ld+json"
    />
  );
};
