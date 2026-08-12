"use client";

import { ActionForm } from "@publira/ui-components/action-form";
import { FormMessage } from "@publira/ui-components/form-message";
import Link from "next/link";

import { useTenantId } from "#lib/use-tenant-id";

import { signupAction } from "../_lib/actions";

export const SignupForm = () => {
  const tenantId = useTenantId();

  return (
    <>
      <div className="space-y-6 rounded-lg border border-border/70 bg-card p-8">
        <ActionForm action={signupAction} className="space-y-4">
          {({ isPending, state }) => (
            <>
              <input name="tenantId" type="hidden" value={tenantId} />

              <div>
                <label htmlFor="name" className="block text-sm font-medium">
                  お名前
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  placeholder="山田太郎"
                  className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm placeholder-muted-foreground focus:ring-2 focus:ring-primary focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="email" className="block text-sm font-medium">
                  メールアドレス
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="your@email.com"
                  className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm placeholder-muted-foreground focus:ring-2 focus:ring-primary focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium">
                  パスワード
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="••••••••"
                  className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm placeholder-muted-foreground focus:ring-2 focus:ring-primary focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-sm font-medium"
                >
                  パスワード（確認）
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  placeholder="••••••••"
                  className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm placeholder-muted-foreground focus:ring-2 focus:ring-primary focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={isPending}
                className="mt-6 w-full rounded bg-primary px-4 py-2 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {isPending ? "登録中..." : "新規登録"}
              </button>

              {state && !state.ok ? (
                <FormMessage variant="destructive">{state.message}</FormMessage>
              ) : null}
            </>
          )}
        </ActionForm>
      </div>

      <div className="mt-4 text-center text-sm">
        <span className="text-muted-foreground">
          すでにアカウントをお持ちの方は
        </span>{" "}
        <Link
          href="/login"
          className="font-medium text-primary hover:underline"
        >
          ログイン
        </Link>
      </div>
    </>
  );
};
