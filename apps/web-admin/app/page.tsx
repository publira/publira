import { Badge } from "@publira/ui-components/badge";
import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { Checkbox } from "@publira/ui-components/checkbox";
import { ConfirmDialog } from "@publira/ui-components/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormActions } from "@publira/ui-components/form-actions";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { RadioGroup } from "@publira/ui-components/radio-group";
import { Select } from "@publira/ui-components/select";
import { Switch } from "@publira/ui-components/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
import { Textarea } from "@publira/ui-components/textarea";

const episodes: {
  id: number;
  publishedAt: string | null;
  status: string;
  title: string;
}[] = [
  {
    id: 1,
    publishedAt: "2026-01-15",
    status: "published",
    title: "第1話 始まりの朝",
  },
  {
    id: 2,
    publishedAt: "2026-01-22",
    status: "published",
    title: "第2話 旅立ちの前夜",
  },
  {
    id: 3,
    publishedAt: null,
    status: "draft",
    title: "第3話 約束の場所",
  },
];

const genreOptions = [
  { label: "ファンタジー", value: "fantasy" },
  { label: "ミステリー", value: "mystery" },
  { label: "エッセイ", value: "essay" },
] as const;

const accessOptions = [
  {
    description: "すべての訪問者が閲覧できます。",
    label: "全体公開",
    value: "public",
  },
  {
    description: "会員登録した読者のみ閲覧できます。",
    label: "会員限定",
    value: "members",
  },
  {
    description: "購入者だけが閲覧できます。",
    label: "有料公開",
    value: "paid",
  },
] as const;

export default function Page() {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 px-6 py-10">
      <Card>
        <CardHeader>
          <CardTitle>シリーズ設定</CardTitle>
          <CardDescription>
            共有コンポーネントを使った管理画面フォームのサンプルです。
          </CardDescription>
        </CardHeader>

        <CardContent className="grid gap-4">
          <Field>
            <FieldLabel htmlFor="series-title" required>
              タイトル
            </FieldLabel>
            <FieldContent>
              <Input
                id="series-title"
                name="title"
                placeholder="作品タイトル"
              />
              <FieldDescription>
                公開ページで表示される作品名です。
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="genre">ジャンル</FieldLabel>
            <Select
              defaultValue="fantasy"
              id="genre"
              items={genreOptions}
              name="genre"
            />
          </Field>

          <Field invalid>
            <FieldLabel htmlFor="summary" required>
              概要
            </FieldLabel>
            <FieldContent>
              <Textarea
                id="summary"
                name="summary"
                placeholder="作品の紹介文を入力"
              />
              <FieldError>概要は 10 文字以上で入力してください。</FieldError>
            </FieldContent>
          </Field>

          <Field className="flex-row items-center gap-2">
            <Checkbox defaultChecked id="published" name="published" />
            <FieldLabel htmlFor="published">即時公開する</FieldLabel>
          </Field>

          <Field>
            <FieldLabel required>公開範囲</FieldLabel>
            <FieldContent>
              <RadioGroup
                defaultValue="public"
                items={accessOptions}
                name="visibility"
                required
              />
              <FieldDescription>
                公開範囲によって読者の閲覧条件が切り替わります。
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field className="flex-row items-center justify-between gap-3 rounded-md border border-input bg-background px-3 py-2">
            <FieldContent className="gap-1">
              <FieldLabel htmlFor="notify-followers">更新通知を送る</FieldLabel>
              <FieldDescription>
                新規エピソード公開時にフォロワーへ通知します。
              </FieldDescription>
            </FieldContent>
            <Switch
              defaultChecked
              id="notify-followers"
              name="notifyFollowers"
            />
          </Field>

          <FormMessage variant="success">
            下書き保存時にカバー画像の最適化とリンク切れチェックを実行します。
          </FormMessage>
        </CardContent>

        <CardFooter>
          <FormActions className="w-full border-t-0 pt-0">
            <Button type="button" variant="outline">
              下書き保存
            </Button>
            <ConfirmDialog
              actionText="公開する"
              actionVariant="default"
              description="公開後はすべての訪問者に表示されます。公開範囲と概要の内容を確認してください。"
              title="この内容で公開しますか？"
              trigger={<Button type="button">公開する</Button>}
            />
          </FormActions>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>エピソード一覧</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>タイトル</TableHead>
              <TableHead>公開状態</TableHead>
              <TableHead>公開日時</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {episodes.length === 0 ? (
              <TableEmptyRow colSpan={3}>
                まだエピソードがありません
              </TableEmptyRow>
            ) : (
              episodes.map((ep) => (
                <TableRow key={ep.id}>
                  <TableCell>{ep.title}</TableCell>
                  <TableCell>
                    <Badge
                      tone={ep.status === "published" ? "success" : "muted"}
                      variant="soft"
                    >
                      {ep.status === "published" ? "公開中" : "下書き"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {ep.publishedAt ?? "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </main>
  );
}
