import { Button, LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { EmptyState } from "@publira/ui-components/empty-state";

import { AdminPage } from "../../../../components/admin-page";

export default function SeriesPage() {
  return (
    <AdminPage
      actions={<Button type="button">新規シリーズ</Button>}
      description="シリーズ編集、公開設定、説明文、並び順をここに集約し、エピソード管理は各シリーズ配下へ入る前提のページです。"
      title="シリーズ"
    >
      <Card>
        <CardHeader>
          <CardTitle>シリーズ管理の着手点</CardTitle>
          <CardDescription>
            エピソードはシリーズに従属するため、一覧から対象シリーズを選んで配下の管理画面へ入る構成を前提にします。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            actions={
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Button type="button" variant="outline">
                  情報設計を追加
                </Button>
                <LinkButton href="/series/1/episodes" variant="default">
                  サンプルシリーズのエピソード管理へ
                </LinkButton>
              </div>
            }
            description="ページタイトル、アクション領域、コンテンツコンテナは他画面と同じ構造のまま、シリーズ詳細とその配下のエピソード管理へ分岐できます。"
            title="シリーズ一覧から対象シリーズを選んでエピソード管理へ遷移します。"
          />
        </CardContent>
      </Card>
    </AdminPage>
  );
}
