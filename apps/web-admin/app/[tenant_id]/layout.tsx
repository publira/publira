import { getMessage, LOCALE_LANG_SCRIPT } from "@publira/i18n";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { tenant_id } from "next/root-params";
import type { ReactNode } from "react";

import { getLocale, loadAdminMessages } from "#lib/locale";
import { getTenantName } from "#lib/public-api";
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
 * `lang` is written by scripts rather than rendered, and this layout stays
 * synchronous.
 *
 * Both values the attribute could take need a read — the operator's cookie, and
 * the tenant's stored default — and a root layout that awaits blocks the whole
 * tree. An `<html>` attribute is never worth that, so neither read happens
 * here: `LOCALE_LANG_SCRIPT` applies the cookie while the document is still
 * being parsed, and `suppressHydrationWarning` is what lets the DOM it produces
 * win over what React rendered.
 *
 * An operator who has chosen no language leaves the document naming none, which
 * is the honest state: a `lang` the page is not written in tells a screen reader
 * to pronounce it in the wrong language, and that is worse for that reader than
 * none. Streaming the tenant default in later is not the answer — a client
 * component can pick its own locale before that arrives, and then the catalog it
 * loads disagrees with the one the server rendered. Carrying the stored default
 * to the client is #1249.
 */
const TenantRootLayout = ({ children }: { children: ReactNode }) => (
  <html suppressHydrationWarning>
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
