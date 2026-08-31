import { getMessage, LOCALE_LANG_SCRIPT } from "@publira/i18n";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { tenant_id } from "next/root-params";
import type { ReactNode } from "react";

import { getLocale, loadAdminMessages } from "#lib/locale";
import { findTenantDisplayLocale, getTenantName } from "#lib/public-api";
import { isTenantIdFormat } from "#lib/tenant-id-format";

import "../globals.css";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await tenant_id();
  if (typeof tenantId !== "string") {
    return {};
  }
  guardPlaceholder(tenantId);

  // A segment that is not a tenant UUID never went through `proxy.ts`, so there
  // is no tenant behind it, no stored default locale to word a title in, and
  // the route below answers 404. Resolving one anyway would read the session —
  // uncached data that this route's otherwise fully prerenderable shell has no
  // `<Suspense>` boundary to hold, which is what Cache Components reports as
  // `blocking-prerender-metadata-dynamic`. Deciding before the read keeps the
  // metadata static, and the not-found page titles itself.
  const normalizedTenantId = tenantId.trim();
  if (!isTenantIdFormat(normalizedTenantId)) {
    return {};
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
 * `lang` is the tenant's stored default locale, corrected to the operator's own
 * choice by the inline script before the browser paints.
 *
 * The console keeps that choice in a cookie rather than in the URL, and under
 * Cache Components a `cookies()` read here would leave every route without a
 * static shell — there is no child `<Suspense>` boundary an `<html>` attribute
 * could move into. The tenant default has no such problem: it is a cached read
 * keyed by the `tenant_id` root parameter, so each tenant's shell prerenders
 * with its own language, and the script then narrows it to the cookie.
 * `suppressHydrationWarning` is what lets the DOM the script produced win over
 * the attribute React rendered. The script's source and the reasoning behind it
 * live in `@publira/i18n`.
 *
 * A tenant whose default cannot be read leaves `lang` unset rather than
 * claiming a language: a wrong one tells a screen reader to pronounce the page
 * in a language it is not written in, which is worse than saying nothing.
 */
const TenantRootLayout = async ({ children }: { children: ReactNode }) => {
  const tenantId = await tenant_id();
  const normalizedTenantId =
    typeof tenantId === "string" ? tenantId.trim() : "";
  const lang = isTenantIdFormat(normalizedTenantId)
    ? await findTenantDisplayLocale(normalizedTenantId)
    : null;

  return (
    <html lang={lang ?? undefined} suppressHydrationWarning>
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
};

export default TenantRootLayout;
