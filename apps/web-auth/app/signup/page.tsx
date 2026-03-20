import Link from "next/link";

export default function SignupPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-serif text-2xl font-semibold">Publira</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            静かに読む、持続可能に出版する
          </p>
        </div>

        <div className="space-y-6 rounded-lg border border-border/70 bg-card p-8">
          <form className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium">
                お名前
              </label>
              <input
                id="name"
                type="text"
                placeholder="山田太郎"
                className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium">
                メールアドレス
              </label>
              <input
                id="email"
                type="email"
                placeholder="your@email.com"
                className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium">
                パスワード
              </label>
              <input
                id="password"
                type="password"
                placeholder="••••••••"
                className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
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
                type="password"
                placeholder="••••••••"
                className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <button
              type="submit"
              className="mt-6 w-full rounded bg-primary px-4 py-2 font-medium text-primary-foreground hover:opacity-90"
            >
              新規登録
            </button>
          </form>
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
      </div>
    </main>
  );
}
