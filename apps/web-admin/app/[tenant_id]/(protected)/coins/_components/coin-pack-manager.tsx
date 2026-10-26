import type { Locale } from "@publira/i18n";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { StatusChip } from "@publira/ui-components/badge";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import * as Sortable from "#components/sortable-list";
import { COIN_PACK_LIMIT } from "#lib/coins";
import type { CoinPackItem } from "#lib/coins";
import { getMessages } from "#lib/get-messages";
import { formatTenantAmount } from "#lib/price";

import { createCoinPackAction, updateCoinPackAction } from "../_lib/actions";
import { COIN_PACK_LIST_TITLE_ID } from "../coin-types";
import { CoinPackFields, CoinPackOnSaleField } from "./coin-pack-fields";
import { CoinPackRetireButton } from "./coin-pack-retire-button";
import { CoinPackSortableList } from "./coin-pack-sortable-list";

interface CoinPackManagerProps {
  /** The tenant's word for its coins in the console's language, or the console's own. */
  coinName: string;
  /** The ISO 4217 code every new price is entered in. */
  currency: string;
  listErrorMessage?: string;
  locale: Locale;
  packs: CoinPackItem[];
  /** The tenant's word as saved, empty before it has one. */
  savedCoinName: string;
  tenantId: string;
}

interface CoinPackRowProps {
  coinName: string;
  currency: string;
  locale: Locale;
  pack: CoinPackItem;
  savedCoinName: string;
  tenantId: string;
  /** The pack as the row names it, which a screen reader hears too. */
  title: string;
}

const CoinPackSaleChip = ({ available }: { available: boolean }) => (
  <StatusChip status={available ? "success" : "muted"}>
    <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
      {available ? (
        <Message message="admin.coins.packs.status.on_sale" />
      ) : (
        <Message message="admin.coins.packs.status.off_sale" />
      )}
    </Suspense>
  </StatusChip>
);

const CoinPackSaveButton = () => (
  <ActionForm.Submit size="sm" variant="outline">
    <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
      <ActionForm.Idle>
        <Message message="admin.coins.packs.save_action" />
      </ActionForm.Idle>
      <ActionForm.Pending>
        <Message message="admin.coins.packs.saving" />
      </ActionForm.Pending>
    </Suspense>
  </ActionForm.Submit>
);

/**
 * One pack, its fields edited in place. Once it has been sold its coins, its
 * bonus, and its price are what a purchase bought, so they are shown rather
 * than offered, with the reason, and only whether it is on sale is left.
 */
const CoinPackRow = ({
  coinName,
  currency,
  locale,
  pack,
  savedCoinName,
  tenantId,
  title,
}: CoinPackRowProps) => (
  <Sortable.Item
    className="grid gap-3 border border-border bg-background px-4 py-3"
    id={pack.id}
    label={title}
  >
    <div className="flex flex-wrap items-center gap-3">
      <Sortable.ItemHandle>
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message
            message="admin.coins.packs.reorder_action"
            values={{ pack: title }}
          />
        </Suspense>
      </Sortable.ItemHandle>
      <p className="text-sm font-medium tabular-nums">{title}</p>
      <p className="text-sm text-muted-foreground tabular-nums">
        {formatTenantAmount(pack.price, {
          currency: pack.currency || null,
          locale,
        })}
      </p>
      <CoinPackSaleChip available={pack.onSale} />
      <div className="ml-auto">
        <CoinPackRetireButton
          coinName={coinName}
          id={pack.id}
          tenantId={tenantId}
          title={title}
        />
      </div>
    </div>
    <ActionForm.Root action={updateCoinPackAction} className="grid gap-3">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="coin_pack_id" type="hidden" value={pack.id} />
      <input name="coin_name" type="hidden" value={savedCoinName} />
      {/* Keyed on what the API stored, so a save remounts the fields on the
          values it came back with. */}
      <ActionForm.Fieldset
        className="grid gap-4 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto_auto] sm:items-end"
        key={[pack.coins, pack.bonusCoins, pack.price, pack.onSale].join(":")}
      >
        {pack.sold ? (
          <>
            <p className="text-sm text-muted-foreground sm:col-span-3">
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message
                  message="admin.coins.packs.sold_note"
                  values={{ coin_name: coinName }}
                />
              </Suspense>
            </p>
            <CoinPackOnSaleField defaultChecked={pack.onSale} />
          </>
        ) : (
          <CoinPackFields coinName={coinName} currency={currency} pack={pack} />
        )}
        <div className="flex h-10 items-center">
          <CoinPackSaveButton />
        </div>
      </ActionForm.Fieldset>
    </ActionForm.Root>
  </Sortable.Item>
);

const CoinPackListBody = async ({
  coinName,
  currency,
  listErrorMessage,
  locale,
  packs,
  savedCoinName,
  tenantId,
}: CoinPackManagerProps) => {
  // A failed read still hands an empty array; the empty state next to the
  // error would read as "this tenant has no packs".
  if (listErrorMessage) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
              <Message message="admin.coins.packs.list_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>
            {listErrorMessage}
          </SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  if (packs.length === 0) {
    return (
      <EmptyState.Root>
        <EmptyState.Heading>
          <EmptyState.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
              <Message message="admin.coins.packs.empty_title" />
            </Suspense>
          </EmptyState.Title>
          <EmptyState.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message
                message="admin.coins.packs.empty_description"
                values={{ coin_name: coinName }}
              />
            </Suspense>
          </EmptyState.Description>
        </EmptyState.Heading>
      </EmptyState.Root>
    );
  }

  // The row's name is a drag label and a dialog value as well as text, so it
  // is resolved as a string.
  const t = await getMessages();

  return (
    <CoinPackSortableList
      rows={packs.map((pack) => ({
        content: (
          <CoinPackRow
            coinName={coinName}
            currency={currency}
            locale={locale}
            pack={pack}
            savedCoinName={savedCoinName}
            tenantId={tenantId}
            title={t("admin.coins.packs.pack_title", {
              bonus: pack.bonusCoins,
              coin_name: coinName,
              count: pack.coins + pack.bonusCoins,
            })}
          />
        ),
        id: pack.id,
      }))}
      tenantId={tenantId}
    />
  );
};

/** The packs on offer, the form that adds one, and the controls on each. */
export const CoinPackManager = (props: CoinPackManagerProps) => {
  const {
    coinName,
    currency,
    listErrorMessage,
    packs,
    savedCoinName,
    tenantId,
  } = props;
  const atLimit = !listErrorMessage && packs.length >= COIN_PACK_LIMIT;

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title id={COIN_PACK_LIST_TITLE_ID}>
            <Suspense fallback={<SkeletonLine className="h-5 w-20" />}>
              <Message message="admin.coins.packs.title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message
                message="admin.coins.packs.description"
                values={{ coin_name: coinName }}
              />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>

      <CoinPackListBody {...props} />

      <div className="grid gap-3 border border-dashed border-border px-4 py-4">
        <h3 className="text-sm font-medium">
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="admin.coins.packs.create_title" />
          </Suspense>
        </h3>
        {atLimit ? (
          <p className="text-sm text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message
                message="admin.coins.packs.validation.limit"
                values={{ count: COIN_PACK_LIMIT }}
              />
            </Suspense>
          </p>
        ) : (
          <ActionForm.Root action={createCoinPackAction} className="grid gap-3">
            <input name="tenant_id" type="hidden" value={tenantId} />
            <input name="coin_name" type="hidden" value={savedCoinName} />
            <ActionForm.Fieldset className="grid gap-4 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto_auto] sm:items-end">
              <CoinPackFields coinName={coinName} currency={currency} />
              <div className="flex h-10 items-center">
                <ActionForm.Submit size="sm">
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <ActionForm.Idle>
                      <Message message="admin.coins.packs.create_action" />
                    </ActionForm.Idle>
                    <ActionForm.Pending>
                      <Message message="admin.coins.packs.creating" />
                    </ActionForm.Pending>
                  </Suspense>
                </ActionForm.Submit>
              </div>
            </ActionForm.Fieldset>
          </ActionForm.Root>
        )}
      </div>
    </ConsoleSection.Root>
  );
};
