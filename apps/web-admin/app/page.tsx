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
  FormActions,
  Input,
  Select,
  Textarea,
} from "@publira/ui-components";

const genreOptions = [
  { label: "ファンタジー", value: "fantasy" },
  { label: "ミステリー", value: "mystery" },
  { label: "エッセイ", value: "essay" },
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
