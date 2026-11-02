"use client";

import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { createContext, use, useMemo, useState } from "react";
import type { ChangeEvent, ComponentProps, ReactNode } from "react";

import { useClientMessages } from "#components/client-message";
import { MAX_INT32 } from "#lib/int32";

interface EpisodePricedContextValue {
  priced: boolean;
  setPriced: (priced: boolean) => void;
}

/** Whether the price the form holds is above 0, as the operator types it. */
const EpisodePricedContext = createContext<EpisodePricedContextValue | null>(
  null
);

const useEpisodePriced = () => {
  const context = use(EpisodePricedContext);

  if (!context) {
    throw new Error("EpisodePriceScope is required.");
  }

  return context;
};

/**
 * The part of an episode form whose fields follow its price: the price input
 * and the preview pages, which a free episode has no use for.
 */
export const EpisodePriceScope = ({
  children,
  initialPrice,
}: {
  children: ReactNode;
  /** The price the price input starts at, in the currency's minor unit. */
  initialPrice: number;
}) => {
  const [priced, setPriced] = useState(initialPrice > 0);
  const context = useMemo(() => ({ priced, setPriced }), [priced]);

  return (
    <EpisodePricedContext value={context}>{children}</EpisodePricedContext>
  );
};

/** The episode's price, posted as `price`. */
export const EpisodePriceInput = (
  props: Omit<ComponentProps<typeof Input>, "onChange">
) => {
  const { setPriced } = useEpisodePriced();

  return (
    <Input
      {...props}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        // An empty input is a price of 0, as the Action reads it.
        setPriced(Number(event.currentTarget.value) > 0);
      }}
    />
  );
};

interface EpisodePreviewPagesFieldProps {
  initialPreviewPageCount: number;
  /**
   * How many pages the episode has now, for the note on a count above it.
   * Absent when they could not be read, and no note is shown.
   */
  pageCount?: number;
}

/**
 * How many of the body's first pages anyone may read before buying the
 * episode, posted as `preview_page_count`. A free episode opens its whole body,
 * so it is shown on a priced one only, and a free one posts 0.
 *
 * A count above the pages the episode has is accepted, since pages are added
 * after the price as often as before, and is noted instead.
 */
export const EpisodePreviewPagesField = ({
  initialPreviewPageCount,
  pageCount,
}: EpisodePreviewPagesFieldProps) => {
  const { priced } = useEpisodePriced();
  const t = useClientMessages();
  const [count, setCount] = useState(initialPreviewPageCount);

  if (!priced) {
    return (
      <Field.Root>
        <input name="preview_page_count" type="hidden" value="0" />
        <Field.Description>
          {t("admin.series.episodes.form.preview_page_count_free")}
        </Field.Description>
      </Field.Root>
    );
  }

  return (
    <Field.Root>
      <Field.Label>
        {t("admin.series.episodes.form.preview_page_count")}
      </Field.Label>
      <Field.Content>
        <Input
          defaultValue={count}
          max={MAX_INT32}
          min={0}
          name="preview_page_count"
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const input = event.currentTarget;
            const value = input.valueAsNumber;

            // The browser's own refusal names no field, so a negative count is
            // refused in the words the Action would use.
            input.setCustomValidity(
              value < 0
                ? t(
                    "admin.series.episodes.validation.preview_page_count_invalid"
                  )
                : ""
            );
            setCount(Number.isNaN(value) ? 0 : value);
          }}
          step={1}
          type="number"
        />
        <Field.Description>
          {t("admin.series.episodes.form.preview_page_count_description")}
        </Field.Description>
        {pageCount !== undefined && count > pageCount ? (
          <Field.Description>
            {t("admin.series.episodes.form.preview_page_count_past_pages", {
              count: pageCount,
            })}
          </Field.Description>
        ) : null}
      </Field.Content>
    </Field.Root>
  );
};
