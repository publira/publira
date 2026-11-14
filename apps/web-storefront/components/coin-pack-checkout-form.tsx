import { Button } from "@publira/ui-components/button";
import type { ReactNode } from "react";

import { LocaleField } from "#components/locale-field";
import * as PaymentProviderChoice from "#components/payment-provider-choice";
import { startCoinPackCheckoutAction } from "#lib/coin-actions";

/**
 * A form that starts the checkout of one pack. From an episode's gate it names
 * the episode, which the checkout sends the reader back to; from `/my/coins`
 * it names none. The button's words are the caller's children, and the
 * provider is the one chosen in the `PaymentProviderChoice.Root` around it.
 */
export const CoinPackCheckoutForm = ({
  children,
  coinPackId,
  returnEpisode,
  size,
  tenantId,
  variant,
}: {
  children: ReactNode;
  coinPackId: string;
  returnEpisode?: {
    id: string;
    publicId: string;
    seriesPublicId: string;
  };
  size?: "lg" | "md";
  tenantId: string;
  variant: "outline" | "secondary";
}) => (
  <form action={startCoinPackCheckoutAction}>
    <LocaleField />
    <input name="tenantId" type="hidden" value={tenantId} />
    <input name="coinPackId" type="hidden" value={coinPackId} />
    {returnEpisode ? (
      <>
        <input name="episodeId" type="hidden" value={returnEpisode.id} />
        <input
          name="episodePublicId"
          type="hidden"
          value={returnEpisode.publicId}
        />
        <input
          name="seriesPublicId"
          type="hidden"
          value={returnEpisode.seriesPublicId}
        />
      </>
    ) : null}
    <PaymentProviderChoice.Input />
    <Button size={size} type="submit" variant={variant}>
      {children}
    </Button>
  </form>
);
