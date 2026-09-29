import { readFile } from "node:fs/promises";

import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

type CatalogNode = string | { [key: string]: CatalogNode };

const leafStrings = (node: CatalogNode): string[] =>
  typeof node === "string" ? [node] : Object.values(node).flatMap(leafStrings);

/**
 * Copy long enough that its presence means the catalog entry, and spelled in
 * characters that neither HTML nor the RSC payload's JSON escapes, so a string
 * that is in the document is found by a plain substring search.
 */
const DISTINCTIVE_COPY = /^[A-Za-z][A-Za-z ]{23,}[A-Za-z]$/u;

/**
 * The document a signed-in `path` answers with — the server-rendered HTML and
 * the RSC payload inlined into it — must hold no string that exists only under
 * the `excluded` top-level keys of `locales/en.json`.
 *
 * A string the page's own namespaces also hold is skipped: the console may
 * render the same English sentence another app does, and that one arrives from
 * its own namespace.
 */
export const expectDocumentWithoutCatalogNamespaces = async (
  page: Page,
  path: string,
  { excluded, included }: { excluded: string[]; included: string[] }
): Promise<void> => {
  const catalog = JSON.parse(
    await readFile(new URL("../../locales/en.json", import.meta.url), "utf-8")
  ) as Record<string, CatalogNode>;

  const allowed = new Set(
    included.flatMap((namespace) => leafStrings(catalog[namespace] ?? {}))
  );
  const copyByNamespace = excluded.map((namespace) => ({
    copy: leafStrings(catalog[namespace] ?? {}).filter(
      (value) => DISTINCTIVE_COPY.test(value) && !allowed.has(value)
    ),
    namespace,
  }));
  expect(
    copyByNamespace.filter(({ copy }) => copy.length === 0),
    "every excluded namespace has copy to look for"
  ).toEqual([]);

  const response = await page.goto(path);
  expect(response?.ok()).toBe(true);
  const html = (await response?.text()) ?? "";

  expect(
    copyByNamespace.flatMap(({ copy, namespace }) =>
      copy.flatMap((value) =>
        html.includes(value) ? [`${namespace}: ${value}`] : []
      )
    ),
    `other apps' copy in ${path}`
  ).toEqual([]);
};
