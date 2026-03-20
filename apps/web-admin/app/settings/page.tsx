import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { EmptyState } from "@publira/ui-components/empty-state";

import { AdminPage } from "../../components/admin-page";

export default function SettingsPage() {
  return (
    <AdminPage
      actions={<Button type="button">設定を編集</Button>}
      description="ブランド、運用設定、権限ポリシーなどを置く前提のページです。"
      title="設定"
    >
      <Card>
        <CardHeader>
          <CardTitle>設定ページの着手点</CardTitle>
          <CardDescription>
            ここではブランドトークンと整合する外観を維持しつつ、管理画面固有の設定
            UI を展開できます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            actions={
              <Button type="button" variant="outline">
                テーマ設定を追加
              </Button>
            }
            description="設定画面も同じページヘッダーとコンテンツ幅を共有します。"
            title="ブランド設定と運用ポリシー UI をここへ実装します。"
          />
        </CardContent>
      </Card>
    </AdminPage>
  );
}
