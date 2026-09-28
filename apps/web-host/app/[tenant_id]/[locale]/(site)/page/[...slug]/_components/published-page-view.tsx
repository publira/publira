import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { MarkdownContent } from "#components/markdown-content";
import { Message } from "#components/message";
import type { PublishedPage } from "#lib/pages";

export const PublishedPageContent = ({
  fallbackLanguage,
  page,
}: {
  /**
   * Autonym of the language the page is shown in, when that is not the
   * language of the route. `null` when the requested translation was served.
   */
  fallbackLanguage: string | null;
  page: PublishedPage;
}) => (
  <div className="mx-auto max-w-(--measure-prose) px-6 py-12">
    {fallbackLanguage ? (
      <p className="mb-8 text-sm leading-6 text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-5 w-full max-w-xl" />}>
          <Message
            message="host.pages.fallback_notice"
            values={{ language: fallbackLanguage }}
          />
        </Suspense>
      </p>
    ) : null}
    <article lang={page.locale}>
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
  </div>
);
