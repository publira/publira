import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { requestPublicEmailChange } from "../../../lib/auth";
import { getTenantSiteLabel } from "../../../lib/tenant";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ tenant_public_id: string }>;
}): Promise<Metadata> => {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  const siteLabel = await getTenantSiteLabel(tenant_public_id);

  return {
    title: `設定 | ${siteLabel}`,
  };
};

const buildSettingsPath = (status: "success" | "error", message: string) => {
  const params = new URLSearchParams({ message, status });
  return `/settings?${params.toString()}`;
};

const requestEmailChangeAction = async (formData: FormData): Promise<void> => {
  "use server";

  const tenantPublicId = String(formData.get("tenantPublicId") ?? "").trim();
  const currentEmail = String(formData.get("currentEmail") ?? "").trim();
  const newEmail = String(formData.get("newEmail") ?? "").trim();
  const currentPassword = String(formData.get("currentPassword") ?? "");

  if (!currentEmail || !newEmail || !currentPassword) {
    redirect(buildSettingsPath("error", "入力内容を確認してください。"));
  }

  const requested = await requestPublicEmailChange(
    tenantPublicId,
    currentEmail,
    newEmail,
    currentPassword
  );
  if (!requested) {
    redirect(
      buildSettingsPath(
        "error",
        "メール変更リクエストに失敗しました。入力内容をご確認ください。"
      )
    );
  }

  redirect(
    buildSettingsPath(
      "success",
      "現在のメールアドレスと新しいメールアドレスの両方に確認メールを送信しました。両方のリンクを開いて変更を完了してください。"
    )
  );
};

const pickFirstQueryParam = (
  value: string | string[] | undefined
): string | undefined => {
  if (Array.isArray(value)) {
    return value.at(0);
  }
  return value;
};

const SettingsPageContent = async ({
  searchParams,
}: {
  searchParams: Promise<{
    message?: string | string[];
    status?: string | string[];
  }>;
}) => {
  const sp = await searchParams;
  const message = pickFirstQueryParam(sp.message)?.trim() ?? "";
  const status = pickFirstQueryParam(sp.status)?.trim() ?? "";

  if (!message) {
    return null;
  }

  return (
    <p
      className={`rounded-md border px-4 py-3 text-sm ${
        status === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-destructive/30 bg-destructive/5 text-destructive"
      }`}
      role={status === "success" ? "status" : "alert"}
    >
      {message}
    </p>
  );
};

const SettingsPageFallback = () => null;

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ tenant_public_id: string }>;
  searchParams: Promise<{
    message?: string | string[];
    status?: string | string[];
  }>;
}) {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">アカウント設定</h1>
        <p className="text-sm text-muted-foreground">
          メールアドレスを変更するには、現在のメールアドレスと新しいメールアドレスの両方で確認が必要です。
        </p>
      </header>

      <Suspense fallback={<SettingsPageFallback />}>
        <SettingsPageContent searchParams={searchParams} />
      </Suspense>

      <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
        <form action={requestEmailChangeAction} className="space-y-4">
          <input name="tenantPublicId" type="hidden" value={tenant_public_id} />

          <div className="space-y-2">
            <label htmlFor="currentEmail" className="text-sm font-medium">
              現在のメールアドレス
            </label>
            <input
              autoComplete="email"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              id="currentEmail"
              name="currentEmail"
              placeholder="current@example.com"
              required
              type="email"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="newEmail" className="text-sm font-medium">
              新しいメールアドレス
            </label>
            <input
              autoComplete="email"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              id="newEmail"
              name="newEmail"
              placeholder="new@example.com"
              required
              type="email"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="currentPassword" className="text-sm font-medium">
              現在のパスワード
            </label>
            <input
              autoComplete="current-password"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              id="currentPassword"
              name="currentPassword"
              placeholder="••••••••"
              required
              type="password"
            />
          </div>

          <button
            className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            type="submit"
          >
            変更確認メールを送信
          </button>
        </form>
      </section>
    </main>
  );
}
