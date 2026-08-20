import { DEFAULT_LOCALE, LOCALE_LANG_SCRIPT } from "@publira/utils/i18n";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { tenant_id } from "next/root-params";
import type { ReactNode } from "react";

import { tenantIdFormSchema } from "#lib/auth-input";
import { getTenantName } from "#lib/public-api";

import "../globals.css";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await tenant_id();
  if (typeof tenantId !== "string") {
    return { title: "管理画面" };
  }
  guardPlaceholder(tenantId);

  const parsed = tenantIdFormSchema.safeParse(tenantId);
  if (!parsed.success) {
    return { title: "管理画面" };
  }

  // `getTenantName` degrades to `null` when the public API is unavailable, so
  // an outage leaves the console titled 「管理画面」 instead of failing every
  // route (#672).
  const tenantName = await getTenantName(parsed.data);
  const base = tenantName ? `${tenantName} 管理画面` : "管理画面";

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
 * behind it live in `@publira/utils/i18n`.
 */
const TenantRootLayout = ({ children }: { children: ReactNode }) => (
  <html lang={DEFAULT_LOCALE} suppressHydrationWarning>
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
