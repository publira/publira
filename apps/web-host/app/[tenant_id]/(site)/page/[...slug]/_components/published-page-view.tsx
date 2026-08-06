import Link from "next/link";

import { MarkdownContent } from "#components/markdown-content";
import type { PublishedPage } from "#lib/pages";

export const PublishedPageContent = ({ page }: { page: PublishedPage }) => (
  <main className="mx-auto max-w-3xl px-6 py-12">
    <article>
      <header className="mb-10">
        <h1 className="font-serif text-4xl font-bold tracking-tight">
          {page.title}
        </h1>
      </header>
      <MarkdownContent
        content={page.contentMarkdown}
        emptyFallback={
          <p className="text-muted-foreground">本文はまだありません。</p>
        }
      />
    </article>
  </main>
);

export const PublishedPageFetchError = () => (
  <main className="mx-auto max-w-3xl px-6 py-12">
    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-center">
      <p className="mb-4 text-destructive">
        ページの取得に失敗しました。時間をおいて再試行してください。
      </p>
      <Link
        href="/"
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        トップへ戻る
      </Link>
    </div>
  </main>
);
