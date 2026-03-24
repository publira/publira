import {
  guardPlaceholder,
  createPlaceholderStaticParams,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { AdminLayout } from "../../../components/admin-layout";
import { AdminToastProvider } from "../../../components/admin-toast-provider";
import { getAdminCurrentUser } from "../../../lib/admin-auth";
import { getTenantForSession } from "../../../lib/tenant-detail";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

interface ProtectedLayoutProps {
  children: ReactNode;
  params: Promise<{ tenant_public_id: string }>;
}

const buildTenantTitleBase = (tenantName: string): string =>
  `管理画面 | ${tenantName}`;

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ tenant_public_id: string }>;
}): Promise<Metadata> => {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  const tenant = await getTenantForSession(tenant_public_id);

  const base = tenant ? buildTenantTitleBase(tenant.name) : "管理画面";

  return {
    title: {
      default: base,
      template: `%s | ${base}`,
    },
  };
};

const ProtectedLayoutFallback = () => (
  <div className="min-h-dvh bg-[linear-gradient(180deg,rgba(255,253,248,0.72),rgba(246,242,233,0.9))]">
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="h-14 animate-pulse rounded-xl border border-border/70 bg-card/60" />
      <div className="mt-6 grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="h-96 animate-pulse rounded-2xl border border-border/70 bg-card/60" />
        <div className="h-96 animate-pulse rounded-2xl border border-border/70 bg-card/60" />
      </div>
    </div>
  </div>
);

export const ProtectedLayoutContent = async ({
  children,
  params,
}: ProtectedLayoutProps) => {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  const currentUser = await getAdminCurrentUser(tenant_public_id);
  if (!currentUser) {
    redirect("/login");
  }

  const tenant = await getTenantForSession(tenant_public_id);
  if (!tenant) {
    notFound();
  }

  return (
    <AdminLayout currentUser={currentUser} tenant={tenant}>
      <AdminToastProvider>{children}</AdminToastProvider>
    </AdminLayout>
  );
};

export default function ProtectedLayout(props: ProtectedLayoutProps) {
  return (
    <Suspense fallback={<ProtectedLayoutFallback />}>
      <ProtectedLayoutContent {...props} />
    </Suspense>
  );
}
