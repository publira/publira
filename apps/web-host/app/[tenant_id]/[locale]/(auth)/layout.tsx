import type { Metadata } from "next";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { DocumentLocale } from "#components/document-locale";
import {
  LocaleProvider,
  TenantDefaultLocaleProvider,
} from "#components/locale-provider";
import { getLocale, tenantDefaultLocale } from "#lib/locale";
import { getTenantSiteInfo } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

const AuthFooter = ({ copyrightText }: { copyrightText?: string }) => {
  const normalizedCopyrightText = copyrightText?.trim() ?? "";

  if (!normalizedCopyrightText) {
    return null;
  }

  return (
    <footer className="border-t border-border/70 bg-surface">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-6 text-center text-sm text-muted-foreground">
        <p>{normalizedCopyrightText}</p>
      </div>
    </footer>
  );
};

const AuthFooterContent = async () => {
  const tenantId = await getTenantId();
  const info = await getTenantSiteInfo(tenantId);
  return <AuthFooter copyrightText={info?.copyrightText} />;
};

const AuthShell = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-dvh flex-col bg-background text-foreground">
    <div className="flex-1">{children}</div>
    <Suspense fallback={null}>
      <AuthFooterContent />
    </Suspense>
  </div>
);

export const metadata: Metadata = {
  title: {
    default: "Publira",
    template: "%s | Publira",
  },
};

/**
 * Seeds the locale context for everything under `(auth)`, the way `(site)`
 * does for the rest of the site: the root layout reads nothing, so this is the
 * first place the request's locale and the tenant's stored default both enter
 * the tree.
 *
 * Neither is awaited here, and that is what leaves the auth screens in the
 * static shell. The request's locale is a root parameter `generateStaticParams`
 * enumerates, so it already has a literal value in a prerender. The tenant's
 * default is a `GetTenant` read, and `[tenant_id]` is a placeholder — one shell
 * is shared by every tenant — so it travels as the read itself and is awaited
 * only where a prefix is actually named: the footer's own `<Suspense>` here,
 * and each `<LocaleLink>` inside the boundary its section already has.
 *
 * Awaiting it in this body instead costs every route under `(auth)` its static
 * shell — Cache Components reports it as `blocking-prerender-runtime` — and
 * `export const instant = false` is not the way out of that (`apps/AGENTS.md`).
 */
const TenantLayout = async ({
  children,
}: LayoutProps<"/[tenant_id]/[locale]">) => {
  const locale = await getLocale();

  return (
    <LocaleProvider locale={locale}>
      <DocumentLocale locale={locale} />
      <TenantDefaultLocaleProvider defaultLocale={tenantDefaultLocale()}>
        <AuthShell>{children}</AuthShell>
      </TenantDefaultLocaleProvider>
    </LocaleProvider>
  );
};

export default TenantLayout;
