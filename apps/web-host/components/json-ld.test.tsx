import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { JsonLd } from "./json-ld";

describe("JsonLd", () => {
  it("renders the document as one JSON-LD script element", () => {
    const html = renderToStaticMarkup(
      <JsonLd
        document={{
          "@context": "https://schema.org",
          "@type": "Person",
          name: "</script><img src=x onerror=alert(1)>",
        }}
      />
    );

    expect(html.startsWith('<script type="application/ld+json">')).toBe(true);
    // The only `</script` is the element's own end tag.
    expect(html.match(/<\/script/giu)).toHaveLength(1);

    const text = html
      .replace('<script type="application/ld+json">', "")
      .replace("</script>", "");
    expect(JSON.parse(text)).toStrictEqual({
      "@context": "https://schema.org",
      "@type": "Person",
      name: "</script><img src=x onerror=alert(1)>",
    });
  });
});
