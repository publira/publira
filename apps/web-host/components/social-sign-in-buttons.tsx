import { Button } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { Message } from "#components/message";
import { TenantIdField } from "#components/tenant-id-field";
import { startSocialSignInAction } from "#lib/social-sign-in-actions";
import { getTenantSignInClients } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

const SignInFields = ({
  provider,
  returnTo,
}: {
  provider: string;
  returnTo: string;
}) => (
  <>
    <LocaleField />
    <TenantIdField />
    <input name="intent" type="hidden" value="login" />
    <input name="provider" type="hidden" value={provider} />
    <input name="returnTo" type="hidden" value={returnTo} />
  </>
);

/** A button per provider the tenant offers, and nothing where it offers none. */
export const SocialSignInButtons = async ({
  returnTo,
}: {
  returnTo: string;
}) => {
  const clients = await getTenantSignInClients(await getTenantId());
  if (!clients.apple && !clients.google) {
    return null;
  }

  return (
    <div className="grid gap-2">
      <p className="text-center text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="inline-block h-4 w-8" />}>
          <Message message="host.auth.social.divider" />
        </Suspense>
      </p>
      {clients.apple ? (
        <form action={startSocialSignInAction}>
          <SignInFields provider="apple" returnTo={returnTo} />
          <Button className="w-full" type="submit" variant="outline">
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="host.auth.social.continue_with_apple" />
            </Suspense>
          </Button>
        </form>
      ) : null}
      {clients.google ? (
        <form action={startSocialSignInAction}>
          <SignInFields provider="google" returnTo={returnTo} />
          <Button className="w-full" type="submit" variant="outline">
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="host.auth.social.continue_with_google" />
            </Suspense>
          </Button>
        </form>
      ) : null}
    </div>
  );
};
