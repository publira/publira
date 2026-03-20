import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  FieldLabel,
  FormActions,
  Input,
} from "@publira/ui-components";

export default function Page() {
  return (
    <main className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-linear-to-b from-surface via-background to-muted/40" />

      <section className="mx-auto grid min-h-[72vh] w-full max-w-6xl gap-12 px-6 pb-16 pt-20 md:grid-cols-[1.2fr_0.8fr] md:items-center">
        <div className="space-y-7">
          <p className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs tracking-[0.12em] text-muted-foreground uppercase">
            Publira Preview
          </p>

          <div className="space-y-4">
            <h1 className="font-['Noto_Serif_JP',serif] text-4xl leading-tight font-semibold md:text-6xl">
              Publish your stories in a calm, elegant space.
            </h1>
            <p className="max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
              読書体験を邪魔しない静かなデザインと、更新しやすい運用導線をひとつにした
              公開ページの仮デザインです。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg">作品を読む</Button>
            <Button size="lg" variant="outline">
              使い方を見る
            </Button>
          </div>

          <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
            <Card>
              <CardContent className="space-y-1 p-4">
                <p className="font-medium text-foreground">読みやすさ重視</p>
                <p>可読性の高い行間と配色</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-1 p-4">
                <p className="font-medium text-foreground">更新に強い</p>
                <p>運用フローに馴染む構造</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-1 p-4">
                <p className="font-medium text-foreground">拡張しやすい</p>
                <p>ブランドトークンで統一</p>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -left-8 -top-8 h-28 w-28 rounded-full bg-primary/20 blur-2xl" />
          <div className="absolute -bottom-8 -right-8 h-28 w-28 rounded-full bg-secondary/20 blur-2xl" />

          <Card className="rounded-2xl">
            <CardHeader>
              <p className="text-xs tracking-[0.08em] text-muted-foreground uppercase">
                Now Reading
              </p>
              <CardTitle>Shangri-la Library</CardTitle>
              <CardDescription>
                光と静けさをテーマにした短編集。落ち着いた余白とともに、ゆっくり読める体験を提供します。
              </CardDescription>
            </CardHeader>

            <CardContent className="grid gap-2 text-sm">
              <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
                <span>第1話</span>
                <span className="text-muted-foreground">公開中</span>
              </div>
              <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
                <span>第2話</span>
                <span className="text-muted-foreground">公開中</span>
              </div>
              <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
                <span>第3話</span>
                <span className="text-muted-foreground">準備中</span>
              </div>

              <Field className="pt-1">
                <FieldLabel htmlFor="email-newsletter">
                  更新通知を受け取る
                </FieldLabel>
                <Input
                  id="email-newsletter"
                  name="email"
                  type="email"
                  placeholder="mail@example.com"
                />
              </Field>
            </CardContent>

            <CardFooter className="flex-col items-stretch">
              <FormActions className="w-full border-t-0 pt-0">
                <Button className="w-full" variant="secondary">
                  続きを読む
                </Button>
              </FormActions>
            </CardFooter>
          </Card>
        </div>
      </section>
    </main>
  );
}
