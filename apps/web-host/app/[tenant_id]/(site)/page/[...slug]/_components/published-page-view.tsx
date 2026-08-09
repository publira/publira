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
