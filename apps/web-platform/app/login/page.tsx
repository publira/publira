import type { ParsedUrlQuery } from "node:querystring";

import { Skeleton } from "@publira/ui-components";
import { Button } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import type { Metadata } from "next";
import { Suspense } from "react";
import * as z from "zod";

import { loginAction } from "./_lib/actions";

export const metadata: Metadata = {
  title: "ログイン",
};

const searchParamsSchema = z.object({
  error: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : ""),
    z.string().optional()
  ),
  next: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : ""),
    z.string().optional()
  ),
});

const LoginForm = async ({
  searchParams,
}: {
  searchParams: Promise<ParsedUrlQuery>;
}) => {
  const params = await searchParams;
  const { error, next } = searchParamsSchema.parse(params);

  return (
    <form action={loginAction} className="space-y-4">
      <input name="next" type="hidden" value={next} />

      <Field>
        <FieldLabel htmlFor="email" required>
          メールアドレス
        </FieldLabel>
        <FieldContent>
          <Input
            autoComplete="email"
            id="email"
            name="email"
            placeholder="operator@example.com"
            required
            type="email"
          />
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel htmlFor="password" required>
          パスワード
        </FieldLabel>
        <FieldContent>
          <Input
            autoComplete="current-password"
            id="password"
            name="password"
            placeholder="••••••••"
            required
            type="password"
          />
        </FieldContent>
      </Field>

      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}

      <Button className="mt-2 w-full" type="submit">
        ログイン
      </Button>
    </form>
  );
};

const LoginFormSkeleton = () => (
  <div className="space-y-4">
    <Skeleton className="h-5 w-1/2" />
    <Skeleton className="h-5 w-1/2" />
    <Skeleton className="h-5 w-1/2" />
    <Skeleton className="h-5 w-1/2" />
    <Skeleton className="h-5 w-full" />
  </div>
);

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-serif text-2xl font-semibold">Publira</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Platform Console ログイン
          </p>
        </div>

        <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
          <Suspense fallback={<LoginFormSkeleton />}>
            <LoginForm searchParams={searchParams} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
