import type { ParsedUrlQuery } from "node:querystring";

import { Skeleton } from "@publira/ui-components";
import type { Metadata } from "next";
import { Suspense } from "react";
import { z } from "zod";

import { LoginForm } from "./_components/login-form";

export const metadata: Metadata = {
  title: "ログイン",
};

const searchParamsSchema = z.object({
  next: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : ""),
    z.string().optional()
  ),
  reset: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : ""),
    z.string().optional()
  ),
});

const LoginFormWrapper = async ({
  searchParams,
}: {
  searchParams: Promise<ParsedUrlQuery>;
}) => {
  const params = await searchParams;
  const { next, reset } = searchParamsSchema.parse(params);

  return <LoginForm nextPath={next} resetDone={reset === "done"} />;
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

const LoginPage = ({ searchParams }: PageProps<"/login">) => (
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
          <LoginFormWrapper searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  </main>
);

export default LoginPage;
