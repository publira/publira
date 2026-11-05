"use client";

import type { Locale } from "@publira/i18n";
import { Button } from "@publira/ui-components/button";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { formatDuration, formatPrice } from "@publira/utils";
import { createContext, use, useActionState, useMemo } from "react";
import type { ReactNode } from "react";

import { useClientMessages } from "#components/client-message";
import { LocaleField } from "#components/locale-field";
import { PROMOTION_CODE_MAX_LENGTH } from "#lib/promotion-code";
import type {
  EpisodeSaleKind,
  PromotionCodeQuote,
  PromotionCodeRefusal,
  PromotionCodeState,
} from "#lib/promotion-code";

/** The state of the field, with each sale named by a string of its caller's. */
type SalesPromotionCodeState = PromotionCodeState<string>;

interface PromotionCodeContextValue {
  apply: (formData: FormData) => void;
  pending: boolean;
  state: SalesPromotionCodeState;
}

const PromotionCodeContext = createContext<PromotionCodeContextValue | null>(
  null
);

/** The search parameter a page reads an applied code back from. */
const PROMOTION_CODE_PARAM = "promotion_code";

/**
 * Writes the applied code into the URL, or takes it out, so a reload quotes
 * the same code again. A refused code is taken out: reloading would only
 * spend another lookup to be refused again.
 */
const keepPromotionCodeInUrl = (code: string): void => {
  const url = new URL(window.location.href);

  if (code) {
    url.searchParams.set(PROMOTION_CODE_PARAM, code);
  } else {
    url.searchParams.delete(PROMOTION_CODE_PARAM);
  }

  window.history.replaceState(null, "", url);
};

/**
 * Holds a page's code: what the field applied, and the price of each sale it
 * applies to, which the checkout buttons render from. The buttons and the
 * field sit apart, so the state is shared through context rather than through
 * a common parent's markup.
 *
 * `initialState` is the code the URL carried, quoted on the server; the page
 * remounts this with a new `key` when the URL brings another one. `action`
 * quotes the code the field posts.
 */
export const PromotionCodeProvider = ({
  action,
  children,
  initialState,
}: {
  action: (
    previous: SalesPromotionCodeState,
    formData: FormData
  ) => Promise<SalesPromotionCodeState>;
  children: ReactNode;
  initialState: SalesPromotionCodeState;
}) => {
  const [state, apply, pending] = useActionState(
    async (previous: SalesPromotionCodeState, formData: FormData) => {
      const next = await action(previous, formData);
      keepPromotionCodeInUrl(next.kind === "applied" ? next.code : "");

      return next;
    },
    initialState
  );

  const value = useMemo(
    () => ({ apply, pending, state }),
    [apply, pending, state]
  );

  return <PromotionCodeContext value={value}>{children}</PromotionCodeContext>;
};

/** The code applied to `sale` and its price there, if the field applied one. */
const useAppliedQuote = (sale: string) => {
  const context = use(PromotionCodeContext);
  const state = context?.state;

  if (state?.kind !== "applied") {
    return null;
  }

  const quote = state.quotes[sale];

  return quote ? { code: state.code, quote } : null;
};

/**
 * What a checkout button says once a code applies to its sale: the sale at
 * the discounted price, said to include tax as the button's own price is, and
 * the price the code was taken off struck through beside it, as a campaign
 * price is shown.
 */
const DiscountedLabel = ({
  currency,
  kind,
  locale,
  quote,
  rentalPeriodHours,
  taxIncluded,
}: {
  currency: string;
  kind: EpisodeSaleKind;
  locale: Locale;
  quote: PromotionCodeQuote;
  rentalPeriodHours?: number;
  taxIncluded: boolean;
}) => {
  const t = useClientMessages();
  const price = formatPrice(quote.price, { currency, locale });

  let label = t("storefront.episode.gate.purchase_for", { price });

  if (kind === "rental") {
    const period = formatDuration({ hours: rentalPeriodHours }, { locale });

    label = taxIncluded
      ? t("storefront.episode.gate.rent_for_tax_included", { period, price })
      : t("storefront.episode.gate.rent_for", { period, price });
  } else if (taxIncluded) {
    label = t("storefront.episode.gate.purchase_for_tax_included", { price });
  }

  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span>{label}</span>
      <s className="font-normal opacity-80">
        <span className="sr-only">
          {t("storefront.promotion_code.list_price")}{" "}
        </span>
        {formatPrice(quote.listPrice, { currency, locale })}
      </s>
    </span>
  );
};

/**
 * A checkout button. Without a code it reads as `children`. Once the field
 * applied a code to its sale, it carries the code into the checkout and names
 * the discounted price.
 */
export const CheckoutSubmit = ({
  children,
  currency,
  kind = "purchase",
  locale,
  rentalPeriodHours,
  sale,
  size,
  taxIncluded,
  variant,
}: {
  /** What the button says while no code applies to its sale. */
  children: ReactNode;
  currency: string | null;
  /** Which wording the discounted price takes. */
  kind?: EpisodeSaleKind;
  locale: Locale;
  rentalPeriodHours?: number;
  /** The key the page's `action` answers this sale's quote under. */
  sale: string;
  size?: "lg";
  /** Whether the tenant states a tax rate, which every price includes. */
  taxIncluded: boolean;
  variant: "outline" | "secondary";
}) => {
  const applied = useAppliedQuote(sale);

  if (!applied || !currency) {
    return (
      <Button size={size} type="submit" variant={variant}>
        {children}
      </Button>
    );
  }

  return (
    <>
      <input name="promotionCode" type="hidden" value={applied.code} />
      <Button size={size} type="submit" variant={variant}>
        <DiscountedLabel
          currency={currency}
          kind={kind}
          locale={locale}
          quote={applied.quote}
          rentalPeriodHours={rentalPeriodHours}
          taxIncluded={taxIncluded}
        />
      </Button>
    </>
  );
};

/** What the field says under itself for each refusal. */
const RefusalMessage = ({
  reason,
  subject,
}: {
  reason: PromotionCodeRefusal;
  subject: PromotionCodeSubject;
}) => {
  const t = useClientMessages();

  switch (reason) {
    case "already_redeemed": {
      return t("storefront.promotion_code.already_redeemed");
    }

    case "exhausted": {
      return t("storefront.promotion_code.exhausted");
    }

    case "expired": {
      return t("storefront.promotion_code.expired");
    }

    case "invalid": {
      return t("storefront.promotion_code.invalid");
    }

    case "not_applicable": {
      return subject === "volumes"
        ? t("storefront.promotion_code.not_applicable_volumes")
        : t("storefront.promotion_code.not_applicable_episode");
    }

    case "rate_limited": {
      return t("storefront.promotion_code.rate_limited");
    }

    default: {
      return t("storefront.promotion_code.error");
    }
  }
};

/** What the code is quoted against, which a refusal names. */
type PromotionCodeSubject = "episode" | "volumes";

interface PromotionCodeFieldProps {
  /** The hidden fields `action` reads beside the code. */
  children: ReactNode;
  subject: PromotionCodeSubject;
}

/**
 * The **Promotion code** disclosure: a field and **Apply**, which quote the
 * code against the sales on the page. It opens by itself while a code is
 * applied or refused, so the answer is never folded away.
 *
 * Applied, it names the code; refused, it says why under the field and leaves
 * the buttons at their prices. Emptying the field and applying takes the code
 * off.
 */
const PromotionCodeDisclosure = ({
  children,
  context: { apply, pending, state },
  subject,
}: PromotionCodeFieldProps & { context: PromotionCodeContextValue }) => {
  const t = useClientMessages();
  const code = state.kind === "none" ? "" : state.code;

  return (
    <details className="w-full max-w-sm" open={state.kind !== "none"}>
      <summary className="cursor-pointer text-sm text-muted-foreground underline-offset-4 hover:underline">
        {t("storefront.promotion_code.label")}
      </summary>
      <form action={apply} className="mt-3 grid gap-2 text-left">
        <LocaleField />
        {children}
        <Field.Root>
          <Field.Label className="sr-only">
            {t("storefront.promotion_code.label")}
          </Field.Label>
          <div className="flex gap-2">
            <Field.Content className="min-w-0 flex-1">
              <Input
                aria-invalid={state.kind === "refused" ? true : undefined}
                autoCapitalize="characters"
                autoComplete="off"
                defaultValue={code}
                maxLength={PROMOTION_CODE_MAX_LENGTH}
                name="promotionCode"
                spellCheck={false}
              />
            </Field.Content>
            <Button disabled={pending} type="submit" variant="outline">
              {t("storefront.promotion_code.apply")}
            </Button>
          </div>
        </Field.Root>
        {state.kind === "refused" ? (
          <FormMessage variant="destructive">
            <RefusalMessage reason={state.reason} subject={subject} />
          </FormMessage>
        ) : null}
        {state.kind === "applied" ? (
          <FormMessage variant="success">
            {t("storefront.promotion_code.applied", { code: state.code })}
          </FormMessage>
        ) : null}
      </form>
    </details>
  );
};

/** Nothing where a page offers no code, outside `PromotionCodeProvider`. */
export const PromotionCodeField = (props: PromotionCodeFieldProps) => {
  const context = use(PromotionCodeContext);

  return context ? (
    <PromotionCodeDisclosure {...props} context={context} />
  ) : null;
};
