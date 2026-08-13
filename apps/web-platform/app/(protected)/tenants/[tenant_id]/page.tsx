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
import { formatDateTime } from "@publira/utils";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AdminDomainPreview } from "#components/admin-domain-preview";
import {
  PlatformPage,
  PlatformPageActions,
  PlatformPageContent,
  PlatformPageDescription,
  PlatformPageEyebrow,
  PlatformPageHeader,
  PlatformPageHeading,
  PlatformPageTitle,
} from "#components/platform-page";
import { TenantDomainCautions } from "#components/tenant-domain-cautions";
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";
import { getTenantStatusLabel, getTenantStatusTone } from "#lib/tenant-labels";
import { getPlatformTenant } from "#lib/tenants";

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
    tenant_id: string;
  }>;
}

const TenantDetailSkeleton = () => (
  <PlatformPageContent>
    <div className="grid gap-6">
      <div className="h-10 w-64 animate-pulse rounded bg-muted/70" />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <div className="h-5 w-28 animate-pulse rounded bg-muted" />
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              <div className="h-16 animate-pulse rounded bg-muted/70" />
              <div className="h-16 animate-pulse rounded bg-muted/70" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="h-5 w-32 animate-pulse rounded bg-muted" />
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              <div className="h-16 animate-pulse rounded bg-muted/70" />
              <div className="h-16 animate-pulse rounded bg-muted/70" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  </PlatformPageContent>
);

const TenantDetailContent = async ({
  params,
}: Pick<TenantDetailPageProps, "params">) => {
  const { tenant_id: tenantId } = await params;

  const [tenant, timeZone] = await Promise.all([
    getPlatformTenant(tenantId),
    getPlatformDisplayTimeZone(),
  ]);

  if (!tenant) {
    notFound();
  }

  const tenantStatusLabel = getTenantStatusLabel(tenant.status);
  const tenantStatusTone = getTenantStatusTone(tenant.status);

  return (
    <>
      <PlatformPageHeader>
        <PlatformPageHeading>
          <PlatformPageEyebrow>Platform Tenants</PlatformPageEyebrow>
          <PlatformPageTitle>{`テナント詳細: ${tenant.name}`}</PlatformPageTitle>
          <PlatformPageDescription>
            テナントの基本情報とドメイン設定を管理します。
          </PlatformPageDescription>
        </PlatformPageHeading>
        <PlatformPageActions>
          <LinkButton render={<Link href="/tenants" />} variant="outline">
            一覧へ戻る
          </LinkButton>
          <LinkButton
            render={
              <Link
                href={`/audit-logs?tenant_id=${encodeURIComponent(tenant.publicId)}`}
              />
            }
            variant="outline"
          >
            監査ログを確認
          </LinkButton>
          {tenant.status === "suspended" ? (
            <form action={resumeTenantAction}>
              <input name="tenant_id" type="hidden" value={tenant.publicId} />
              <Button type="submit">再開する</Button>
            </form>
          ) : (
            <form action={suspendTenantAction}>
              <input name="tenant_id" type="hidden" value={tenant.publicId} />
              <Button type="submit" variant="destructive">
                停止する
              </Button>
            </form>
          )}
        </PlatformPageActions>
      </PlatformPageHeader>
      <PlatformPageContent>
        <div className="grid gap-6">
          <TenantSectionNav current="detail" tenantId={tenant.publicId} />

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
                    name="tenant_id"
                    type="hidden"
                    value={tenant.publicId}
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
                      <p className="text-sm">
                        {formatDateTime(tenant.createdAt, {
                          fallback: "未設定",
                          timeZone,
                        })}
                      </p>
                    </Field>
                    <Field>
                      <FieldLabel>ステータス</FieldLabel>
                      <p>
                        <Badge tone={tenantStatusTone}>
                          {tenantStatusLabel}
                        </Badge>
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
                  テナントのドメイン設定を確認します。
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <TenantDomainCautions mode="update" />
                <TenantUpdateForm action={updateTenantDomainAction}>
                  <input
                    name="tenant_id"
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
                      <FieldLabel required>ドメイン</FieldLabel>
                      <Input
                        key={tenant.domain}
                        defaultValue={tenant.domain}
                        id="tenant_domain"
                        name="tenant_domain"
                        placeholder="tenant-example.example.com"
                        required
                        type="text"
                      />
                    </Field>
                    <Field>
                      <FieldLabel>管理画面ドメイン</FieldLabel>
                      <Input
                        key={tenant.adminDomain}
                        defaultValue={tenant.adminDomain}
                        id="tenant_admin_domain"
                        name="tenant_admin_domain"
                        placeholder={`admin.${tenant.domain}`}
                        type="text"
                      />
                      <AdminDomainPreview
                        adminDomain={tenant.adminDomain}
                        domain={tenant.domain}
                        showCurrentDomain
                      />
                    </Field>
                  </div>
                </TenantUpdateForm>
              </CardContent>
            </Card>
          </div>
        </div>
      </PlatformPageContent>
    </>
  );
};

// `PlatformPage` stays in the static shell so the max width and padding are
// painted before `params` resolves; only the header and body stream in.
const TenantDetailPage = ({ params }: TenantDetailPageProps) => (
  <PlatformPage>
    <Suspense fallback={<TenantDetailSkeleton />}>
      <TenantDetailContent params={params} />
    </Suspense>
  </PlatformPage>
);

export default TenantDetailPage;
