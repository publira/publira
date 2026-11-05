import { Button, LinkButton } from "@publira/ui-components/button";
import * as Dialog from "@publira/ui-components/dialog";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatList, formatPrice } from "@publira/utils";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { Message } from "#components/message";
import type { TenantSales } from "#lib/app-payments";
import { buildLoginPath } from "#lib/auth-shared";
import type { EpisodeDetail } from "#lib/catalog";
import { getMyEpisodeRating } from "#lib/episode-rating";
import { getLocale } from "#lib/locale";
import { getTenantDefaultLocale } from "#lib/tenant";

import { startTipCheckoutAction } from "../_lib/actions";
import { EpisodeDialogPortal } from "./episode-dialog-portal";

const TipButtonLabel = () => (
  <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
    <Message message="storefront.episode.tip.button" />
  </Suspense>
);

/**
 * **Tip the Authors**, beside the reaction control on the page after the last
 * one: a dialog naming the episode's Authors, with each of the tenant's amounts
 * as a button that hands the reader to the provider's checkout of that amount.
 *
 * The reader is read here for what the shared episode read cannot say, so this
 * sits in a `<Suspense>` of its own. Whether the episode credits them comes
 * from the private read the reaction control beside it makes, because the
 * episode read reports a credit only as what opens a priced episode, and a free
 * one is opened by nothing. A reader that read could not place is offered
 * nothing rather than a press the API may refuse; the reaction control is what
 * says the read failed.
 *
 * The site offers it only where it could take the payment: the tenant takes
 * tips, and a provider is ready. A guest goes to sign in and comes back to the
 * episode, since a tip is given by an account.
 */
export const EpisodeTipControl = async ({
  amounts,
  episode,
  returnTo,
  sales,
  seriesPublicId,
  tenantId,
}: {
  /** The tenant's amounts, empty while it takes no tips. */
  amounts: readonly number[];
  episode: Pick<EpisodeDetail, "credits" | "id" | "publicId">;
  /** The episode's path, which a sign-in comes back to. */
  returnTo: string;
  /** Whether the site can take a payment, and in which currency. */
  sales: TenantSales;
  seriesPublicId: string;
  tenantId: string;
}) => {
  const { currency } = sales;

  if (!sales.web || !currency || amounts.length === 0) {
    return null;
  }

  const locale = await getLocale();

  const [defaultLocale, reader] = await Promise.all([
    getTenantDefaultLocale(tenantId),
    getMyEpisodeRating(tenantId, episode.id, locale),
  ]);

  if (!reader.ok || reader.readerCredited) {
    return null;
  }

  if (!reader.signedIn) {
    return (
      <LinkButton
        href={buildLoginPath(locale, defaultLocale, returnTo)}
        variant="outline"
      >
        <TipButtonLabel />
      </LinkButton>
    );
  }

  // One person credited in two roles is one Author to give to.
  const creators = [...new Set(episode.credits.map(({ name }) => name))].filter(
    Boolean
  );

  return (
    <Dialog.Root>
      <Dialog.Trigger render={<Button type="button" variant="outline" />}>
        <TipButtonLabel />
      </Dialog.Trigger>
      <EpisodeDialogPortal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup className="grid gap-4 text-left">
            <Dialog.Header>
              <Dialog.Title className="text-lg font-semibold">
                <TipButtonLabel />
              </Dialog.Title>
              <Dialog.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <Message message="storefront.episode.tip.description" />
                </Suspense>
              </Dialog.Description>
            </Dialog.Header>
            {creators.length > 0 ? (
              <p className="text-sm font-medium">
                <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                  <Message
                    message="storefront.episode.tip.creators"
                    values={{ creators: formatList(creators, { locale }) }}
                  />
                </Suspense>
              </p>
            ) : null}
            <form
              action={startTipCheckoutAction}
              className="flex flex-wrap gap-2"
            >
              <LocaleField />
              <input name="episodeId" type="hidden" value={episode.id} />
              <input
                name="episodePublicId"
                type="hidden"
                value={episode.publicId}
              />
              <input
                name="seriesPublicId"
                type="hidden"
                value={seriesPublicId}
              />
              <input name="tenantId" type="hidden" value={tenantId} />
              {amounts.map((amount) => (
                <Button
                  className="tabular-nums"
                  key={amount}
                  name="amount"
                  type="submit"
                  value={amount}
                  variant="outline"
                >
                  {formatPrice(amount, { currency, locale })}
                </Button>
              ))}
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </EpisodeDialogPortal>
    </Dialog.Root>
  );
};
