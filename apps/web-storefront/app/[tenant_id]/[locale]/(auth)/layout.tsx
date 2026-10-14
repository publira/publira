import type { Metadata } from "next";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { DocumentLocale } from "#components/document-locale";
import {
  LocaleProvider,
  TenantLocalesProvider,
} from "#components/locale-provider";
import { getTenantSiteInfo } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

const AuthFooter = ({ copyrightText }: { copyrightText?: string }) => {
  const normalizedCopyrightText = copyrightText?.trim() ?? "";

  if (!normalizedCopyrightText) {
    return null;
  }

  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto flex w-full max-w-measure-prose flex-col gap-4 px-6 py-6 text-sm text-muted-foreground">
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

/**
 * The auth screens are the same for every visitor until their form is used, so
 * the App Shell a default `<Link>` loads is the static one. A cookie read under
 * `(auth)` — the session, or the email flash cookie the `requested` and
 * `pending` screens show — renders after the shell instead of making it one
 * per session. This does not fail the build: Next.js validates nothing at
 * `"shell"`, and a read outside `<Suspense>` already fails as a blocking
 * prerender.
 */
export const ensureStatic = "shell";

export const metadata: Metadata = {
  title: {
    default: "Publira",
    template: "%s | Publira",
  },
};

/**
 * Awaits nothing, so every route under `(auth)` keeps its static shell; the
 * providers hand their reads down unresolved.
 */
const AuthLayout = ({ children }: LayoutProps<"/[tenant_id]/[locale]">) => (
  <LocaleProvider>
    <DocumentLocale />
    <TenantLocalesProvider>
      <AuthShell>{children}</AuthShell>
    </TenantLocalesProvider>
  </LocaleProvider>
);

export default AuthLayout;
