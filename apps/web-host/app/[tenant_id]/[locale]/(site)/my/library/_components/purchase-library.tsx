import { SectionError } from "@publira/ui-components/section-error";
import { formatDateTime } from "@publira/utils";

import { LocaleLink } from "#components/locale-link";
import type { PurchaseItem } from "#lib/purchases";

import { purchasesListHref } from "../_lib/search-params";

interface PurchaseLibraryProps {
  listErrorMessage?: string;
  nextToken: string;
  previousToken: string;
  purchases: PurchaseItem[];
  timeZone: string;
}

const PurchasePagination = ({
  nextToken,
  previousToken,
}: {
  nextToken: string;
  previousToken: string;
}) => (
  <nav
    aria-label="購入履歴のページング"
    className="mt-6 flex items-center justify-center gap-6"
  >
    {previousToken ? (
      <LocaleLink
        className="text-sm text-primary underline-offset-4 hover:underline"
        href={purchasesListHref(previousToken)}
      >
        前のページ
      </LocaleLink>
    ) : (
      <span className="text-sm text-muted-foreground">前のページ</span>
    )}
    {nextToken ? (
      <LocaleLink
        className="text-sm text-primary underline-offset-4 hover:underline"
        href={purchasesListHref(nextToken)}
      >
        次のページ
      </LocaleLink>
    ) : (
      <span className="text-sm text-muted-foreground">次のページ</span>
    )}
  </nav>
);

const PurchaseCard = ({
  purchase,
  timeZone,
}: {
  purchase: PurchaseItem;
  timeZone: string;
}) => {
  const href = `/series/${purchase.series.publicId}/episodes/${purchase.episode.publicId}`;
  const expiryLabel = purchase.expiresAt
    ? formatDateTime(purchase.expiresAt, { fallback: "-", timeZone })
    : "期限なし";

  return (
    <article className="rounded-xl border border-border/70 bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            {purchase.series.title}
          </p>
          <h3 className="mt-1 font-medium">
            <LocaleLink className="hover:underline" href={href}>
              #{purchase.episode.orderIndex} {purchase.episode.title}
            </LocaleLink>
          </h3>
        </div>
        <span
          className={
            purchase.isActive
              ? "rounded-full bg-success/15 px-2 py-1 text-xs font-medium text-success"
              : "rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground"
          }
        >
          {purchase.isActive ? "閲覧可能" : "期限切れ"}
        </span>
      </div>
      <dl className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
        <div>
          <dt>購入日</dt>
          <dd className="mt-1 text-foreground">
            {formatDateTime(purchase.purchasedAt, { fallback: "-", timeZone })}
          </dd>
        </div>
        <div>
          <dt>購入価格</dt>
          <dd className="mt-1 text-foreground">
            ¥{purchase.priceAtPurchase.toLocaleString("ja-JP")}
          </dd>
        </div>
        <div>
          <dt>有効期限</dt>
          <dd className="mt-1 text-foreground">{expiryLabel}</dd>
        </div>
      </dl>
      <div className="mt-4">
        <LocaleLink
          className="text-sm text-primary underline-offset-4 hover:underline"
          href={href}
        >
          エピソードを開く
        </LocaleLink>
      </div>
    </article>
  );
};

export const PurchaseLibrary = ({
  listErrorMessage,
  nextToken,
  previousToken,
  purchases,
  timeZone,
}: PurchaseLibraryProps) => {
  const activePurchases = purchases.filter((purchase) => purchase.isActive);
  const expiredPurchases = purchases.filter((purchase) => !purchase.isActive);

  return (
    <div className="space-y-6">
      {listErrorMessage ? (
        <SectionError
          description={listErrorMessage}
          title="購入済み一覧を表示できませんでした"
        />
      ) : null}
      {!listErrorMessage && purchases.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-6">
          <h2 className="text-lg font-semibold">
            購入済みのエピソードはありません
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            購入したエピソードは、ここからいつでも開けます。
          </p>
          <LocaleLink
            className="mt-4 inline-flex text-sm text-primary underline-offset-4 hover:underline"
            href="/series"
          >
            シリーズを探す
          </LocaleLink>
        </section>
      ) : null}
      {activePurchases.length > 0 ? (
        <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">本棚</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              現在閲覧できる購入済みエピソードです。
            </p>
          </div>
          <div className="grid gap-3">
            {activePurchases.map((purchase) => (
              <PurchaseCard
                key={purchase.id}
                purchase={purchase}
                timeZone={timeZone}
              />
            ))}
          </div>
        </section>
      ) : null}
      {expiredPurchases.length > 0 ? (
        <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">購入履歴</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              有効期限が終了した購入です。エピソードの詳細を確認できます。
            </p>
          </div>
          <div className="grid gap-3">
            {expiredPurchases.map((purchase) => (
              <PurchaseCard
                key={purchase.id}
                purchase={purchase}
                timeZone={timeZone}
              />
            ))}
          </div>
        </section>
      ) : null}
      {!listErrorMessage && purchases.length > 0 ? (
        <PurchasePagination
          nextToken={nextToken}
          previousToken={previousToken}
        />
      ) : null}
    </div>
  );
};
