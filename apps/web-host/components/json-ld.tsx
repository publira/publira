import type { Thing, WithContext } from "schema-dts";

import { serializeJsonLd } from "#lib/json-ld";

/**
 * One schema.org document, as the `<script>` a search engine reads it from.
 *
 * A plain `<script>` rather than `next/script`: the content is data, not code,
 * and nothing loads or runs it. It renders wherever the page puts it, so a
 * page places it next to the read it describes and outside any gate that
 * withholds the body from a first-time visitor.
 */
export const JsonLd = ({ document }: { document: WithContext<Thing> }) => (
  <script
    dangerouslySetInnerHTML={{ __html: serializeJsonLd(document) }}
    type="application/ld+json"
  />
);
