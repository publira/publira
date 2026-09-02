import type { Metadata } from "next";
import { Suspense } from "react";
import type { ReactNode } from "react";

import {
  LocaleProvider,
  TenantDefaultLocaleProvider,
} from "#components/locale-provider";
import { getLocale } from "#lib/locale";
import { getTenantDefaultLocale, getTenantSiteInfo } from "#lib/tenant";
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

const AuthShellFallback = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-dvh flex-col bg-background text-foreground">
    <div className="flex-1">{children}</div>
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
 * first place the request's locale and the tenant's stored default both exist.
 *
 * The `<Suspense>` below still stands between the shell and whatever the page
 * itself waits on; what this layout awaits is the pair of values every link
 * under it needs before it can name an href.
 */
const TenantLayout = async ({
  children,
}: LayoutProps<"/[tenant_id]/[locale]">) => {
  const [locale, tenantId] = await Promise.all([getLocale(), getTenantId()]);
  const defaultLocale = await getTenantDefaultLocale(tenantId);

  return (
    <LocaleProvider locale={locale}>
      <TenantDefaultLocaleProvider defaultLocale={defaultLocale}>
        <Suspense fallback={<AuthShellFallback>{children}</AuthShellFallback>}>
          <AuthShell>{children}</AuthShell>
        </Suspense>
      </TenantDefaultLocaleProvider>
    </LocaleProvider>
  );
};

export default TenantLayout;
