"use client";

import { RadioGroup } from "@publira/ui-components/radio-group";
import type { RadioGroupProps } from "@publira/ui-components/radio-group";
import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { isPromotionCodeDiscountKind } from "#lib/promotion-code-shared";
import type { PromotionCodeDiscountKindValue } from "#lib/promotion-code-shared";

interface PromotionCodeDiscountContextValue {
  kind: PromotionCodeDiscountKindValue;
  setKind: (kind: PromotionCodeDiscountKindValue) => void;
}

const PromotionCodeDiscountContext =
  createContext<PromotionCodeDiscountContextValue | null>(null);

const usePromotionCodeDiscount = () => {
  const context = use(PromotionCodeDiscountContext);

  if (!context) {
    throw new Error("Rendered outside a PromotionCodeDiscount.");
  }

  return context;
};

/**
 * Holds how the code takes its discount off, posted as `discount_kind`. The
 * field the discount is typed in follows it, since a percentage and an amount
 * are read differently.
 */
const PromotionCodeDiscountRoot = ({ children }: { children: ReactNode }) => {
  const [kind, setKind] = useState<PromotionCodeDiscountKindValue>("percent");
  const context = useMemo(() => ({ kind, setKind }), [kind]);

  return (
    <PromotionCodeDiscountContext value={context}>
      <input name="discount_kind" type="hidden" value={kind} />
      {children}
    </PromotionCodeDiscountContext>
  );
};

/** The kind picker; `items` carry the rendered wording of each kind. */
const PromotionCodeDiscountRadioGroup = ({
  items,
}: {
  items: RadioGroupProps["items"];
}) => {
  const { kind, setKind } = usePromotionCodeDiscount();

  return (
    <RadioGroup
      className="sm:grid-cols-2"
      items={items}
      onValueChange={(value) => {
        if (isPromotionCodeDiscountKind(value)) {
          setKind(value);
        }
      }}
      value={kind}
    />
  );
};

/** Renders its children only while the discount is of the kind it names. */
const PromotionCodeDiscountWhen = ({
  children,
  kind,
}: {
  children: ReactNode;
  kind: PromotionCodeDiscountKindValue;
}) => (usePromotionCodeDiscount().kind === kind ? children : null);

export {
  PromotionCodeDiscountRoot as Root,
  PromotionCodeDiscountRadioGroup as RadioGroup,
  PromotionCodeDiscountWhen as When,
};
