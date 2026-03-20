import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FormMessage,
  FormActions,
  Input,
  RadioGroup,
  Select,
  Switch,
  Textarea,
} from "@publira/ui-components";

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
            <Switch defaultChecked id="notify-followers" name="notifyFollowers" />
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
            <Button type="submit">公開する</Button>
          </FormActions>
        </CardFooter>
      </Card>

      <EmptyState
        title="まだエピソードがありません"
        description="エピソードを作成すると、ここに一覧が表示されます。"
        actions={<Button variant="secondary">最初のエピソードを作る</Button>}
      />
    </main>
  );
}
