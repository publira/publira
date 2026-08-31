import { getMessage, LOCALE_LANG_SCRIPT } from "@publira/i18n";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { tenant_id } from "next/root-params";
import type { ReactNode } from "react";

import { FALLBACK_LOCALE } from "#lib/fallback-locale";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { getTenantName } from "#lib/public-api";
import { isTenantIdFormat } from "#lib/tenant-id-format";

import "../globals.css";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await tenant_id();
  if (typeof tenantId !== "string") {
    const messages = await loadAdminMessages(FALLBACK_LOCALE);

    return { title: getMessage(messages, "admin.shell.title") };
  }
  guardPlaceholder(tenantId);

  // A segment that is not a tenant UUID never went through `proxy.ts`, so
  // there is no tenant and no session behind it and the title is the
  // locale-independent fallback whichever way the locale resolves. Resolving it
  // anyway would read the session — uncached data that this route's otherwise
  // fully prerenderable shell has no `<Suspense>` boundary to hold, which is
  // what Cache Components reports as `blocking-prerender-metadata-dynamic`.
  // Deciding before the read keeps the metadata static instead.
  const normalizedTenantId = tenantId.trim();
  if (!isTenantIdFormat(normalizedTenantId)) {
    const messages = await loadAdminMessages(FALLBACK_LOCALE);

    return { title: getMessage(messages, "admin.shell.title") };
  }

  // The title is copy, so it follows the cookie like every other string. It
  // costs the shell nothing: metadata is resolved in its own pass and streamed
  // into the document, so this read stays out of the route's static shell.
  const locale = await getLocale(normalizedTenantId);
  const messages = await loadAdminMessages(locale);

  // `getTenantName` degrades to `null` when the public API is unavailable, so
  // an outage leaves the console titled 「管理画面」 instead of failing every
  // route (#672).
  const tenantName = await getTenantName(normalizedTenantId);
  const base = tenantName
    ? getMessage(messages, "admin.shell.tenant_title", { name: tenantName })
    : getMessage(messages, "admin.shell.title");

  return {
    title: {
      default: base,
      template: `%s | ${base}`,
    },
  };
};

/**
 * `lang` is rendered as the default locale and corrected by the inline script
 * before the browser paints.
 *
 * The console keeps its locale in a cookie rather than in the URL, and under
 * Cache Components a `cookies()` read here would leave every route without a
 * static shell — there is no child `<Suspense>` boundary an `<html>` attribute
 * could move into. Reading the cookie in the script instead keeps the shell
 * static; `suppressHydrationWarning` is what lets the DOM the script produced
 * win over the attribute React rendered. The script's source and the reasoning
 * behind it live in `@publira/i18n`.
 */
const TenantRootLayout = ({ children }: { children: ReactNode }) => (
  <html lang={FALLBACK_LOCALE} suppressHydrationWarning>
    <head>
      <script dangerouslySetInnerHTML={{ __html: LOCALE_LANG_SCRIPT }} />
      {/* Dynamic per-tenant overrides from GET /theme.css (short Cache-Control). */}
      {/* oxlint-disable-next-line next/no-css-tags, react-doctor/nextjs-no-css-link -- runtime tenant theme route */}
      <link href="/theme.css" rel="stylesheet" />
    </head>
    <body className="min-h-dvh bg-background text-foreground antialiased">
      {children}
    </body>
  </html>
);

export default TenantRootLayout;
