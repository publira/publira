import { Badge } from "@publira/ui-components/badge";
import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
import Link from "next/link";

import { PlatformPage } from "../../../components/platform-page";

const tenants: {
  publicId: string;
  name: string;
  plan: "enterprise" | "growth" | "starter";
  status: "active" | "suspended" | "trial";
  updatedAt: string;
}[] = [
  {
    name: "青楓出版",
    plan: "enterprise",
    publicId: "tenant_seifuu",
    status: "active",
    updatedAt: "2026-03-21 08:40",
  },
  {
    name: "空詩舎",
    plan: "growth",
    publicId: "tenant_kuushisha",
    status: "trial",
    updatedAt: "2026-03-20 17:16",
  },
  {
    name: "星川書苑",
    plan: "starter",
    publicId: "tenant_hoshikawa",
    status: "suspended",
    updatedAt: "2026-03-18 11:03",
  },
];

const statusLabelMap = {
  active: "稼働中",
  suspended: "停止中",
  trial: "トライアル",
} as const;

const statusToneMap = {
  active: "success",
  suspended: "destructive",
  trial: "info",
} as const;

const planLabelMap = {
  enterprise: "Enterprise",
  growth: "Growth",
  starter: "Starter",
} as const;

export default function TenantsPage() {
  return (
    <PlatformPage
      actions={
        <Link href="/tenants/new">
          <Button type="button">新規テナント作成</Button>
        </Link>
      }
      description="プラットフォーム運営者が横断でテナントの状態を確認し、詳細画面へ遷移するための起点です。"
      eyebrow="Platform Tenants"
      title="テナント一覧"
    >
      <Card>
        <CardHeader>
          <CardTitle>登録テナント</CardTitle>
          <CardDescription>
            web-admin
            と責務分離するため、ここではテナント単位の状態管理に限定します。
          </CardDescription>
        </CardHeader>

        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>テナント</TableHead>
                <TableHead className="w-44">プラン</TableHead>
                <TableHead className="w-40">状態</TableHead>
                <TableHead className="w-52">更新日時</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((tenant) => (
                <TableRow key={tenant.publicId}>
                  <TableCell>
                    <div className="grid gap-1">
                      <p className="font-medium text-foreground">
                        {tenant.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {tenant.publicId}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>{planLabelMap[tenant.plan]}</TableCell>
                  <TableCell>
                    <Badge tone={statusToneMap[tenant.status]}>
                      {statusLabelMap[tenant.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>{tenant.updatedAt}</TableCell>
                  <TableCell>
                    <Link href={`/tenants/${tenant.publicId}`}>
                      <Button size="sm" type="button" variant="outline">
                        詳細
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PlatformPage>
  );
}
