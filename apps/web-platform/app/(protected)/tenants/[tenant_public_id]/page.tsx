import { Badge } from "@publira/ui-components/badge";
import { Button, LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { Field, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PlatformPage } from "../../../../components/platform-page";
import {
  getTenantStatusLabel,
  getTenantStatusTone,
} from "../../../../lib/tenant-labels";
import { getPlatformTenant } from "../../../../lib/tenants";
import { TenantSectionNav } from "./_components/tenant-section-nav";
import { TenantUpdateForm } from "./_components/tenant-update-form";
import {
  resumeTenantAction,
  suspendTenantAction,
  updateTenantDomainAction,
  updateTenantNameAction,
} from "./_lib/actions";

export const metadata: Metadata = {
  title: "テナント詳細",
};

interface TenantDetailPageProps {
  params: Promise<{
    tenant_public_id: string;
  }>;
}

export default async function TenantDetailPage({
  params,
}: TenantDetailPageProps) {
  const { tenant_public_id: tenantPublicId } = await params;

  const tenant = await getPlatformTenant(tenantPublicId);

  if (!tenant) {
    notFound();
  }

  const tenantStatusLabel = getTenantStatusLabel(tenant.status);
  const tenantStatusTone = getTenantStatusTone(tenant.status);
  const hasDomain = tenant.domain.trim().length > 0;

  return (
    <PlatformPage
      actions={
        <>
          <LinkButton render={<Link href="/tenants" />} variant="outline">
            一覧へ戻る
          </LinkButton>
          <LinkButton
            render={
              <Link
                href={`/audit-logs?resource=${encodeURIComponent(tenant.publicId)}`}
              />
            }
            variant="outline"
          >
            監査ログを確認
          </LinkButton>
          {tenant.status === "suspended" ? (
            <form action={resumeTenantAction}>
              <input
                name="tenant_public_id"
                type="hidden"
                value={tenant.publicId}
              />
              <Button type="submit">再開する</Button>
            </form>
          ) : (
            <form action={suspendTenantAction}>
              <input
                name="tenant_public_id"
                type="hidden"
                value={tenant.publicId}
              />
              <Button type="submit" variant="destructive">
                停止する
              </Button>
            </form>
          )}
        </>
      }
      description="テナントの基本情報とドメイン設定を管理します。"
      eyebrow="Platform Tenants"
      title={`テナント詳細: ${tenant.name}`}
    >
      <div className="grid gap-6">
        <TenantSectionNav current="detail" tenantPublicId={tenant.publicId} />

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>基本情報</CardTitle>
              <CardDescription>
                テナントの表示名と現在の状態を管理します。
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <TenantUpdateForm action={updateTenantNameAction}>
                <input
                  name="tenant_public_id"
                  type="hidden"
                  value={tenant.publicId}
                />
                <input
                  name="tenant_current_subdomain"
                  type="hidden"
                  value={tenant.subdomain}
                />
                <input
                  name="tenant_current_domain"
                  type="hidden"
                  value={tenant.domain}
                />
                <div className="grid gap-4">
                  <Field>
                    <FieldLabel required>テナント名</FieldLabel>
                    <Input
                      key={tenant.name}
                      defaultValue={tenant.name}
                      name="tenant_name"
                      required
                      type="text"
                    />
                  </Field>
                  <Field>
                    <FieldLabel>作成日時</FieldLabel>
                    <p className="text-sm">{tenant.createdAt || "未設定"}</p>
                  </Field>
                  <Field>
                    <FieldLabel>ステータス</FieldLabel>
                    <p>
                      <Badge tone={tenantStatusTone}>{tenantStatusLabel}</Badge>
                    </p>
                  </Field>
                </div>
              </TenantUpdateForm>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>ドメイン設定</CardTitle>
              <CardDescription>
                サブドメインとカスタムドメインの設定値を確認します。
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <TenantUpdateForm action={updateTenantDomainAction}>
                <input
                  name="tenant_public_id"
                  type="hidden"
                  value={tenant.publicId}
                />
                <input
                  name="tenant_current_name"
                  type="hidden"
                  value={tenant.name}
                />
                <div className="grid gap-4">
                  <Field>
                    <FieldLabel required>サブドメイン</FieldLabel>
                    <Input
                      key={tenant.subdomain}
                      defaultValue={tenant.subdomain}
                      name="tenant_subdomain"
                      placeholder="mycompany"
                      required
                      type="text"
                    />
                  </Field>
                  <Field>
                    <FieldLabel>カスタムドメイン</FieldLabel>
                    <Input
                      key={tenant.domain}
                      defaultValue={hasDomain ? tenant.domain : ""}
                      name="tenant_domain"
                      placeholder="example.com"
                      type="text"
                    />
                  </Field>
                </div>
              </TenantUpdateForm>
            </CardContent>
          </Card>
        </div>
      </div>
    </PlatformPage>
  );
}
