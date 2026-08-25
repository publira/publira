import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { parseSettingsFlashSearchParams } from "./_lib/search-params";
import { SettingsTabs } from "./settings-tabs";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const metadata: Metadata = {
  title: "設定",
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
  const { message, status } = parseSettingsFlashSearchParams(
    (await searchParams) ?? {}
  );

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
  // No session check here: `/settings` is a member path the proxy already
  // gates, and awaiting one in a layout body would keep the segment out of its
  // static shell. Each section re-authenticates its own read instead.
  <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
    <header className="space-y-4 border-b border-border/50 pb-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">アカウント設定</h1>
        <p className="text-sm text-muted-foreground">
          プロフィール・フォロー・通知・セキュリティ・アカウント情報を管理できます。
        </p>
      </div>
      <SettingsTabs />
    </header>

    <FlashMessage searchParams={searchParams} />

    {children}
  </main>
);

export default SettingsLayout;
