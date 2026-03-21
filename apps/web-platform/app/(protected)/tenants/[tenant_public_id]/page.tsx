import { Badge } from "@publira/ui-components/badge";
import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import Link from "next/link";

import { PlatformPage } from "../../../../components/platform-page";

interface TenantDetailPageProps {
  params: Promise<{
    tenant_public_id: string;
  }>;
}

export default async function TenantDetailPage({
  params,
}: TenantDetailPageProps) {
  const { tenant_public_id: tenantPublicId } = await params;

  return (
    <PlatformPage
      actions={
        <>
          <Link href="/tenants">
            <Button type="button" variant="outline">
              一覧へ戻る
            </Button>
          </Link>
          <Button type="button">状態を更新</Button>
        </>
      }
      description="テナント境界のメタ情報と運用状態を確認する画面です。コンテンツ入稿の詳細運用は web-admin に委譲します。"
      eyebrow="Platform Tenants"
      title={`テナント詳細: ${tenantPublicId}`}
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>基本情報</CardTitle>
            <CardDescription>
              本画面は「テナント状態・契約・連絡先」を扱う境界として定義しています。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <p>
              <span className="font-medium">tenant_public_id:</span>{" "}
              {tenantPublicId}
            </p>
            <p>
              <span className="font-medium">ステータス:</span>{" "}
              <Badge tone="success">active</Badge>
            </p>
            <p>
              <span className="font-medium">プラン:</span> Growth
            </p>
            <p>
              <span className="font-medium">契約開始:</span> 2026-02-01
            </p>
            <p>
              <span className="font-medium">連絡先:</span> ops@example.com
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>責務分担メモ</CardTitle>
            <CardDescription>
              Issue #110 で定義した web-platform と web-admin の境界です。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm text-muted-foreground">
            <p>web-platform: テナント横断の状態管理と監査</p>
            <p>web-admin: テナント内の入稿・公開運用</p>
            <p>データ連携: tenant_public_id を共有キーとして利用</p>
          </CardContent>
        </Card>
      </div>
    </PlatformPage>
  );
}
