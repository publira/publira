import { Checkbox } from "@publira/ui-components/checkbox";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { CoinPackItem } from "#lib/coins";
import { MAX_INT32 } from "#lib/int32";
import {
  maxPriceInputValue,
  priceInputStep,
  toPriceInputValue,
} from "#lib/price";

/** Whether readers can buy the pack, the one field a sold pack still has. */
export const CoinPackOnSaleField = ({
  defaultChecked,
}: {
  defaultChecked: boolean;
}) => (
  <Field.Root className="self-end">
    <div className="flex h-10 items-center gap-2">
      <Checkbox defaultChecked={defaultChecked} name="on_sale" />
      <Field.Label>
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="admin.coins.packs.on_sale" />
        </Suspense>
      </Field.Label>
    </div>
  </Field.Root>
);

interface CoinPackFieldsProps {
  /** The tenant's word for its coins in the console's language, or the console's own. */
  coinName: string;
  /** ISO 4217 code of the currency the price is entered in, the tenant's. */
  currency: string;
  /** The pack a row edits; left out on the form that adds one. */
  pack?: Pick<CoinPackItem, "bonusCoins" | "coins" | "onSale" | "price">;
}

/** The coins, the bonus, the price, and the sale state a pack is saved with. */
export const CoinPackFields = ({
  coinName,
  currency,
  pack,
}: CoinPackFieldsProps) => (
  <>
    <Field.Root>
      <Field.Label required>
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message
            message="admin.coins.packs.coins"
            values={{ coin_name: coinName }}
          />
        </Suspense>
      </Field.Label>
      <Field.Content>
        <Input
          defaultValue={pack?.coins}
          max={MAX_INT32}
          min="1"
          name="coins"
          required
          step="1"
          type="number"
        />
      </Field.Content>
    </Field.Root>

    <Field.Root>
      <Field.Label>
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message
            message="admin.coins.packs.bonus_coins"
            values={{ coin_name: coinName }}
          />
        </Suspense>
      </Field.Label>
      <Field.Content>
        <Input
          defaultValue={pack?.bonusCoins}
          max={MAX_INT32}
          min="0"
          name="bonus_coins"
          step="1"
          type="number"
        />
      </Field.Content>
    </Field.Root>

    <Field.Root>
      <Field.Label required>
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="admin.coins.packs.price" values={{ currency }} />
        </Suspense>
      </Field.Label>
      <Field.Content>
        <Input
          defaultValue={
            pack === undefined
              ? undefined
              : toPriceInputValue(pack.price, currency)
          }
          max={maxPriceInputValue(currency)}
          min={priceInputStep(currency)}
          name="price"
          required
          step={priceInputStep(currency)}
          type="number"
        />
        <input name="price_currency" type="hidden" value={currency} />
      </Field.Content>
    </Field.Root>

    <CoinPackOnSaleField defaultChecked={pack?.onSale ?? true} />
  </>
);
