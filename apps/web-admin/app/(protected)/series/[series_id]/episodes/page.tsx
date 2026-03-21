import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { EmptyState } from "@publira/ui-components/empty-state";

import { AdminPage } from "../../../../../components/admin-page";

export const generateStaticParams = () => Promise.resolve([{ series_id: "1" }]);

export default async function SeriesEpisodesPage({
  params,
}: PageProps<"/series/[series_id]/episodes">) {
  const { series_id } = await params;

  return (
    <AdminPage
      actions={<Button type="button">エピソードと画像を追加</Button>}
      description="下書き、本文編集、画像追加、予約公開までをシリーズ配下の同じ管理ページで扱う前提です。"
      eyebrow={`Series ${series_id}`}
      title="エピソード"
    >
      <Card>
        <CardHeader>
          <CardTitle>シリーズ配下のエピソード運用</CardTitle>
          <CardDescription>
            シリーズ ID {series_id}{" "}
            に属するエピソード本文と添付画像を同じコンテキストで扱い、公開制御まで一続きの導線に寄せます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            actions={
              <Button type="button" variant="outline">
                画像要件を定義
              </Button>
            }
            description="エピソード一覧、本文エディタ、画像アップロード、予約公開 UI をシリーズ詳細配下に追加できます。"
            title="シリーズ配下のエピソード管理ページに画像追加導線をまとめます。"
          />
        </CardContent>
      </Card>
    </AdminPage>
  );
}
