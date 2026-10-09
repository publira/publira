/**
 * The page a suspended tenant's site and console answer every request with.
 *
 * The APIs refuse a suspended tenant before they do anything else, its domain
 * lookup included, so the proxy that makes that lookup is the first and only
 * place that learns of it — and the proxy has to answer with the status as
 * well as the page. A crawler reads `503` as an absence that ends, which is
 * what a suspension is, while a rewrite into the App Router cannot carry a
 * status of its own: the route it lands on renders `200`. So the document is
 * written here, as a whole, and handed back as the proxy's response.
 *
 * Nothing on it is the tenant's. The lookup that would have named the
 * tenant's language, colours, and name is the one that was refused, so the
 * page renders in the brand defaults (`@publira/brand`) and in a language
 * chosen from the request alone.
 */

import {
  LOCALE_COOKIE_NAME,
  negotiateInitialLocale,
  parseLocaleCookie,
  RESOLVED_LOCALE_COOKIE_NAME,
} from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * The language the page is written in: the one the URL names, then the
 * visitor's own choice, then the default the console last published for this
 * host, then `Accept-Language`.
 *
 * The cookies are read here, unlike everywhere else on the server, because
 * the tenant's stored default is exactly what cannot be read now; the
 * resolved-locale cookie is the copy of it this browser was handed while the
 * tenant was being served.
 */
export const suspendedTenantLocale = (
  request: NextRequest,
  pathLocale: Locale | null = null
): Locale =>
  pathLocale ??
  parseLocaleCookie(request.cookies.get(LOCALE_COOKIE_NAME)?.value) ??
  parseLocaleCookie(request.cookies.get(RESOLVED_LOCALE_COOKIE_NAME)?.value) ??
  negotiateInitialLocale(request.headers.get("accept-language"));

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '"': "&quot;",
  "&": "&amp;",
  "'": "&#39;",
  "<": "&lt;",
  ">": "&gt;",
};

const escapeHtml = (value: string): string =>
  value.replaceAll(/["&'<>]/gu, (character) => HTML_ESCAPES[character]);

/**
 * The brand defaults of `@publira/brand/theme.css`, written out because the
 * page loads no stylesheet: the apps' own are build artifacts whose URLs only
 * the App Router knows.
 */
const STYLE = [
  "body{margin:0;min-height:100dvh;background:#f5f5f2;color:#1f1d1a;",
  'font-family:"Hiragino Sans","BIZ UDPGothic","Yu Gothic","Noto Sans CJK JP","Noto Sans JP",system-ui,sans-serif;',
  "-webkit-font-smoothing:antialiased}",
  "main{box-sizing:border-box;max-width:40rem;margin:0 auto;padding:4rem 1.5rem}",
  'h1{margin:0 0 1rem;font-family:"Hiragino Mincho ProN","BIZ UDPMincho","Yu Mincho","Noto Serif CJK JP","Noto Serif JP",serif;',
  "font-size:1.875rem;font-weight:400;line-height:1.25}",
  "p{margin:0;line-height:1.6}",
].join("");

/**
 * The `503` a suspended tenant answers with, as a complete HTML document.
 *
 * `no-store` keeps a browser or a cache in front of the app from answering
 * with it after the tenant is resumed, and `noindex` keeps a crawler that
 * fetches it anyway from filing it under the tenant's URLs. No `Retry-After`
 * is sent: a suspension has no end anyone could name.
 */
export const suspendedTenantResponse = ({
  description,
  locale,
  title,
}: {
  description: string;
  locale: Locale;
  title: string;
}): NextResponse => {
  const html = [
    "<!doctype html>",
    `<html lang="${escapeHtml(locale)}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${STYLE}</style>`,
    "</head>",
    "<body>",
    "<main>",
    `<h1>${escapeHtml(title)}</h1>`,
    `<p>${escapeHtml(description)}</p>`,
    "</main>",
    "</body>",
    "</html>",
  ].join("");

  return new NextResponse(html, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Language": locale,
      "Content-Type": "text/html; charset=utf-8",
    },
    status: 503,
  });
};
