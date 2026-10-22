import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SignUpClosedNotice } from "#components/sign-up-closed-notice";
import { getTenantSignUp } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

/**
 * The tenant's notice for a first sign-in with Apple or Google that the API
 * refused because sign-up is closed. It is shown on the refusal rather than on
 * the setting, which the cached site read may not have caught up with yet.
 */
export const RefusedSignUpNotice = async () => {
  const signUp = await getTenantSignUp(await getTenantId());

  return (
    <SignUpClosedNotice message={signUp.open ? undefined : signUp.message} />
  );
};

/**
 * The way to the sign-up screen, or in its place the tenant's notice while
 * sign-up is closed. After a refused first sign-in the notice already stands
 * above the form, so it is not said twice.
 */
export const SignUpPrompt = async ({ refused }: { refused: boolean }) => {
  const signUp = await getTenantSignUp(await getTenantId());
  if (!signUp.open) {
    return refused ? null : <SignUpClosedNotice message={signUp.message} />;
  }
  if (refused) {
    return null;
  }

  return (
    <p className="text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
        <Message message="storefront.auth.login.no_account" />
      </Suspense>{" "}
      <Suspense fallback={<SkeletonLine className="inline-block h-4 w-12" />}>
        <LocaleLink
          href="/signup"
          className="text-primary underline underline-offset-4"
        >
          <Message message="storefront.auth.login.signup" />
        </LocaleLink>
      </Suspense>
    </p>
  );
};
