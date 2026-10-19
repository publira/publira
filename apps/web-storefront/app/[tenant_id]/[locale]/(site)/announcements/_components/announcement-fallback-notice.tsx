import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

/**
 * What a reader browsing in one language is told when the announcement was not
 * written in it, worded as a page's note is. `null` renders nothing, which is
 * the announcement shown in the reader's own language.
 */
export const AnnouncementFallbackNotice = ({
  language,
}: {
  /** Autonym of the language it is shown in, from `fallbackLanguage`. */
  language: string | null;
}) =>
  language ? (
    <p className="text-sm leading-6 text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-full max-w-xl" />}>
        <Message
          message="storefront.announcements.fallback_notice"
          values={{ language }}
        />
      </Suspense>
    </p>
  ) : null;
