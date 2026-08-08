import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { SettingsTabs } from "./settings-tabs";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const generateMetadata = async ({
  params: _params,
}: {
  params: Promise<{ tenant_id: string }>;
}): Promise<Metadata> => {
  const tenantId = await getTenantId();

  const siteLabel = await getTenantSiteLabel(tenantId);

  return {
    title: `設定 | ${siteLabel}`,
  };
};

const pickFirstQueryParam = (
  value: string | string[] | undefined
): string | undefined => {
  if (Array.isArray(value)) {
    return value.at(0);
  }
  return value;
};

const FlashMessage = async ({
  searchParams,
}: {
  searchParams: Promise<
    | {
        message?: string | string[];
        status?: string | string[];
      }
    | undefined
  >;
}) => {
  const sp = await searchParams;
  if (!sp) {
    return null;
  }

  const message = pickFirstQueryParam(sp.message)?.trim() ?? "";
  const status = pickFirstQueryParam(sp.status)?.trim() ?? "";

  if (!message) {
    return null;
  }

  return (
    <p
      className={`rounded-md border px-4 py-3 text-sm ${
        status === "success"
          ? "border-success/30 bg-success/10 text-success"
          : "border-destructive/30 bg-destructive/10 text-destructive"
      }`}
      role={status === "success" ? "status" : "alert"}
    >
      {message}
    </p>
  );
};

const SettingsLayout = ({
  children,
  params: _params,
  searchParams,
}: {
  children: ReactNode;
  params: Promise<{ tenant_id: string }>;
  searchParams: Promise<
    | {
        message?: string | string[];
        status?: string | string[];
      }
    | undefined
  >;
}) => (
  <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
    <header className="space-y-4 border-b border-border/50 pb-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">アカウント設定</h1>
        <p className="text-sm text-muted-foreground">
          プロフィール・通知・セキュリティ・アカウント情報を管理できます。
        </p>
      </div>
      <SettingsTabs />
    </header>

    <FlashMessage searchParams={searchParams} />

    {children}
  </main>
);

export default SettingsLayout;
