import { StatusChip } from "@publira/ui-components/badge";
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

import { PlatformPage } from "../../components/platform-page";

const stats = [
  {
    detail: "24h で 1 件増加",
    label: "稼働テナント",
    value: "42",
  },
  {
    detail: "審査待ち 3 件",
    label: "作成申請中",
    value: "5",
  },
  {
    detail: "7 日以内",
    label: "要対応アラート",
    value: "8",
  },
  {
    detail: "重大インシデントなし",
    label: "監査ログ監視",
    value: "Healthy",
  },
] as const;

const recentEvents = [
  {
    action: "テナント作成",
    actor: "operator.yamada",
    at: "2026-03-21 10:22",
    target: "tenant_hoshikawa",
  },
  {
    action: "プラン変更",
    actor: "operator.sato",
    at: "2026-03-21 09:02",
    target: "tenant_aozora",
  },
  {
    action: "オペレーター権限更新",
    actor: "owner.nakano",
    at: "2026-03-20 18:14",
    target: "operator.kimura",
  },
] as const;

export default function Page() {
  return (
    <PlatformPage
      actions={
        <>
          <Link href="/audit-logs">
            <Button type="button" variant="outline">
              監査ログを見る
            </Button>
          </Link>
          <Link href="/tenants/new">
            <Button type="button">テナントを作成</Button>
          </Link>
        </>
      }
      description="web-platform 初期リリース向けに、共通レイアウトと導線を固定したダッシュボードです。各画面 Issue はこのシェルを前提に実装できます。"
      eyebrow="Platform Dashboard"
      title="横断オペレーションの基準点"
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((item) => (
          <Card key={item.label}>
            <CardHeader className="gap-3">
              <CardDescription>{item.label}</CardDescription>
              <CardTitle className="text-3xl">{item.value}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-sm text-muted-foreground">
              {item.detail}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)]">
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="grid gap-1">
              <CardTitle>直近の横断イベント</CardTitle>
              <CardDescription>
                テナント作成・権限変更・プラン変更を同じ監査導線で追跡します。
              </CardDescription>
            </div>
            <StatusChip status="info">更新 3 件</StatusChip>
          </CardHeader>

          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>操作</TableHead>
                  <TableHead>対象</TableHead>
                  <TableHead className="w-52">実行者</TableHead>
                  <TableHead className="w-52">時刻</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentEvents.map((event) => (
                  <TableRow key={`${event.at}-${event.target}`}>
                    <TableCell className="font-medium">
                      {event.action}
                    </TableCell>
                    <TableCell>{event.target}</TableCell>
                    <TableCell>{event.actor}</TableCell>
                    <TableCell>{event.at}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>初期リリース画面</CardTitle>
            <CardDescription>
              下記 5
              画面を同一シェルで実装開始できるよう、ルーティングを固定しています。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm text-muted-foreground">
            <p>・テナント一覧</p>
            <p>・テナント作成</p>
            <p>・テナント詳細</p>
            <p>・オペレーター管理</p>
            <p>・監査ログ</p>
          </CardContent>
        </Card>
      </div>
    </PlatformPage>
  );
}
