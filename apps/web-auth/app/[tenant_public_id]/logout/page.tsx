import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import Link from "next/link";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

export default async function LogoutPage({
  params,
}: PageProps<"/[tenant_public_id]/logout">) {
  const { tenant_public_id } = await params;

  guardPlaceholder(tenant_public_id);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mb-8">
          <h1 className="font-serif text-2xl font-semibold">Publira</h1>
        </div>

        <div className="space-y-6 rounded-lg border border-border/70 bg-card p-8">
          <div>
            <h2 className="text-lg font-semibold">ログアウトしました</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              またのご利用をお待ちしています
            </p>
          </div>

          <button
            type="button"
            className="w-full rounded bg-primary px-4 py-2 font-medium text-primary-foreground hover:opacity-90"
          >
            トップページへ
          </button>
        </div>

        <div className="mt-4 text-center text-sm">
          <Link
            href="/login"
            className="font-medium text-primary hover:underline"
          >
            再度ログイン
          </Link>
        </div>
      </div>
    </main>
  );
}
