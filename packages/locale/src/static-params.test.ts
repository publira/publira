import { getLocales } from "@publira/i18n";
import { describe, expect, it } from "vitest";

import { generateLocaleStaticParams } from "./static-params";

describe("generateLocaleStaticParams", () => {
  it("emits one entry per locale", () => {
    expect(generateLocaleStaticParams()).toEqual(
      getLocales().map((locale) => ({ locale }))
    );
  });

  it("keeps the caller's other root segments and the locale", () => {
    expect(generateLocaleStaticParams({ tenant_id: "_" })).toEqual(
      getLocales().map((locale) => ({ locale, tenant_id: "_" }))
    );
  });
});
