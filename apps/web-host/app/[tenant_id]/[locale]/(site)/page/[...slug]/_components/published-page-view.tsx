import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { MarkdownContent } from "#components/markdown-content";
import { Message } from "#components/message";
import type { PublishedPage } from "#lib/pages";

export const PublishedPageContent = ({ page }: { page: PublishedPage }) => (
  <main className="mx-auto max-w-(--measure-prose) px-6 py-12">
    <article>
      <header className="mb-10">
        <h1 className="font-serif text-3xl leading-tight">{page.title}</h1>
      </header>
      <MarkdownContent
        content={page.contentMarkdown}
        emptyFallback={
          <p className="text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
              <Message message="host.pages.body_empty" />
            </Suspense>
          </p>
        }
      />
    </article>
  </main>
);
