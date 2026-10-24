import * as AuthScreen from "@publira/layouts/auth-screen";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

/**
 * What the site tells a visitor while the tenant has closed sign-up: that no
 * account can be made, in the tenant's own words where it wrote some.
 *
 * The tenant's message is plain text, so its line breaks are kept rather than
 * read as markup.
 */
export const SignUpClosedNotice = ({ message }: { message?: string }) => (
  <section aria-labelledby="sign-up-closed-title" className="grid gap-2">
    <h2 className="text-base font-semibold" id="sign-up-closed-title">
      <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
        <Message message="storefront.auth.sign_up_closed.title" />
      </Suspense>
    </h2>
    <div className="whitespace-pre-line">
      <AuthScreen.Text>
        {message ?? (
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="storefront.auth.sign_up_closed.default_message" />
          </Suspense>
        )}
      </AuthScreen.Text>
    </div>
  </section>
);
