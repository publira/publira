import { Badge, StatusChip } from "@publira/ui-components/badge";
import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { EmptyState } from "@publira/ui-components/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";

import { AdminPage } from "../../components/admin-page";

const stats = [
  {
    detail: "今週は 2 件を更新",
    label: "公開中シリーズ",
    value: "12",
  },
  {
    detail: "校正待ちは 7 件",
    label: "下書きエピソード",
    value: "28",
  },
  {
    detail: "48 時間以内に 3 件",
    label: "予約公開",
    value: "9",
  },
  {
    detail: "画像差し替え依頼あり",
    label: "要確認素材",
    value: "4",
  },
] as const;

const publishingQueue: {
  assignee: string;
  schedule: string;
  series: string;
  status: "draft" | "review" | "scheduled";
  title: string;
}[] = [
  {
    assignee: "佐伯",
    schedule: "本日 19:00",
    series: "海風と活版印刷",
    status: "review",
    title: "第14話 港で待つ手紙",
  },
  {
    assignee: "小野",
    schedule: "明日 08:30",
    series: "月暦工房日誌",
    status: "scheduled",
    title: "第3話 硝子温室の朝",
  },
  {
    assignee: "高村",
    schedule: "未設定",
    series: "紙魚堂奇譚",
    status: "draft",
    title: "第8話 目録の空白",
  },
] as const;

const handoffItems = [
  {
    description:
      "シリーズ編集画面はヘッダー右側のアクション領域を使う前提に揃えます。",
    label: "ページタイトルと主要アクションの配置を固定化",
  },
  {
    description:
      "小さい画面ではサイドバーがドロワーへ切り替わり、同じナビゲーション項目を再利用します。",
    label: "モバイル導線を共通化",
  },
  {
    description:
      "web-admin/components 配下に閉じたため、公開サイト向け package を汚さずに拡張できます。",
    label: "Admin 専用レイアウトをアプリ内に隔離",
  },
] as const;

const getPublishingQueueTone = (
  status: (typeof publishingQueue)[number]["status"]
) => {
  if (status === "scheduled") {
    return "info" as const;
  }

  if (status === "review") {
    return "warning" as const;
  }

  return "muted" as const;
};

const getPublishingQueueStatusLabel = (
  status: (typeof publishingQueue)[number]["status"]
) => {
  if (status === "scheduled") {
    return "予約済み";
  }

  if (status === "review") {
    return "レビュー中";
  }

  return "下書き";
};

export default function Page() {
  return (
    <AdminPage
      actions={
        <>
          <Button type="button" variant="outline">
            公開キューを見る
          </Button>
          <Button type="button">シリーズを作成</Button>
        </>
      }
      description="認証後の共通レイアウト、サイドバー、ヘッダー、ページコンテナ、モバイル切り替えをまとめた基礎画面です。ここを起点に各管理画面を同じシェルで実装できます。"
      eyebrow="Admin Dashboard"
      title="編集運用のベースライン"
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(19rem,1fr)]">
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="grid gap-1">
              <CardTitle>公開キュー</CardTitle>
              <CardDescription>
                直近で確認が必要なエピソードと公開予定です。
              </CardDescription>
            </div>
            <StatusChip status="warning">2 件がレビュー待ち</StatusChip>
          </CardHeader>

          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>シリーズ</TableHead>
                  <TableHead>エピソード</TableHead>
                  <TableHead className="w-36">担当</TableHead>
                  <TableHead className="w-36">状態</TableHead>
                  <TableHead className="w-36">予定</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {publishingQueue.map((item) => (
                  <TableRow key={`${item.series}-${item.title}`}>
                    <TableCell className="font-medium">{item.series}</TableCell>
                    <TableCell>{item.title}</TableCell>
                    <TableCell>{item.assignee}</TableCell>
                    <TableCell>
                      <Badge tone={getPublishingQueueTone(item.status)}>
                        {getPublishingQueueStatusLabel(item.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>{item.schedule}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>レイアウト引き継ぎ事項</CardTitle>
              <CardDescription>
                主要画面 Issue
                がこのシェルを前提に着手できるよう、固定しておきたい基礎要素です。
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {handoffItems.map((item) => (
                <div
                  className="rounded-2xl border border-border/70 bg-muted/35 p-4"
                  key={item.label}
                >
                  <p className="text-sm font-medium text-foreground">
                    {item.label}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <EmptyState
                actions={
                  <Button type="button" variant="outline">
                    設計メモを確認
                  </Button>
                }
                description="個別画面の本実装は次段階ですが、ページヘッダーとコンテンツコンテナはすでに共通化されています。"
                title="次の画面はこの枠組みを複製して着手できます。"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminPage>
  );
}
