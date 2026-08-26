import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import type { MeInfo } from "#lib/auth";
import { getMe, getNotificationSettings } from "#lib/auth";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

const MY_RETURN_TO = "/my";

const EmptyState = ({
  description,
  title,
}: {
  description: string;
  title: string;
}) => (
  <div className="rounded-xl border border-dashed border-border/70 bg-muted/30 p-5">
    <p className="text-sm font-medium text-foreground">{title}</p>
    <p className="mt-1 text-sm text-muted-foreground">{description}</p>
  </div>
);

const ProfileSection = ({ me }: { me: MeInfo }) => (
  <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
    <h2 className="mb-4 text-lg font-semibold">プロフィール</h2>
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div className="rounded-lg border border-border/60 p-3">
        <dt className="text-muted-foreground">表示名</dt>
        <dd className="mt-1 font-medium">{me?.name ?? "未設定"}</dd>
      </div>
      <div className="rounded-lg border border-border/60 p-3">
        <dt className="text-muted-foreground">ユーザーID</dt>
        <dd className="mt-1 font-medium">{me?.publicId ?? "-"}</dd>
      </div>
    </dl>
    <div className="mt-4 flex justify-end">
      <LocaleLink
        className="inline-flex rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
        href="/settings"
      >
        設定ページへ
      </LocaleLink>
    </div>
  </section>
);

const ProfileSectionFallback = () => (
  <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
    <h2 className="mb-4 text-lg font-semibold">プロフィール</h2>
    <div className="h-24 w-full animate-pulse rounded-md bg-muted" />
  </section>
);

const SubscriptionSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const notificationSettings = await withPublicSessionReauth(
    locale,
    MY_RETURN_TO,
    () => getNotificationSettings(tenantId)
  );
  let notificationStatusText = "購読中";
  if (notificationSettings === null) {
    notificationStatusText = "確認できません";
  } else if (notificationSettings.emailNotificationsEnabled === false) {
    notificationStatusText = "停止中";
  }

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">購読情報</h2>
      <div className="rounded-lg border border-border/60 p-3 text-sm">
        <p className="text-muted-foreground">メール通知の購読設定</p>
        <p className="mt-1 font-medium">{notificationStatusText}</p>
      </div>
      <div className="mt-4">
        <EmptyState
          description="現在表示できる購読コンテンツ情報はありません。"
          title="購読中のコンテンツがありません"
        />
      </div>
    </section>
  );
};

const SubscriptionSectionFallback = () => (
  <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
    <h2 className="mb-4 text-lg font-semibold">購読情報</h2>
    <div className="h-20 w-full animate-pulse rounded-md bg-muted" />
  </section>
);

const MyContent = async () => {
  const locale = await getLocale();
  await requirePublicSession(locale, MY_RETURN_TO);
  const tenantId = await getTenantId();
  const me = await withPublicSessionReauth(locale, MY_RETURN_TO, () =>
    getMe(tenantId)
  );

  return (
    <>
      <Suspense fallback={<ProfileSectionFallback />}>
        {me ? (
          <ProfileSection me={me} />
        ) : (
          <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold">プロフィール</h2>
            <p className="text-sm text-muted-foreground">
              セッションを確認できませんでした。再ログインしてください。
            </p>
            <div className="mt-4">
              <LocaleLink
                className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                href="/login?returnTo=%2Fmy"
              >
                ログインへ
              </LocaleLink>
            </div>
          </section>
        )}
      </Suspense>

      {me ? (
        <Suspense fallback={<SubscriptionSectionFallback />}>
          <SubscriptionSection />
        </Suspense>
      ) : null}

      <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">読書履歴</h2>
        <EmptyState
          description="作品を読むと、最近の履歴がここに表示されます。"
          title="まだ読書履歴がありません"
        />
      </section>
    </>
  );
};

const MyContentFallback = () => (
  <>
    <ProfileSectionFallback />
    <SubscriptionSectionFallback />
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">読書履歴</h2>
      <div className="h-20 w-full animate-pulse rounded-md bg-muted" />
    </section>
  </>
);

const MyPage = () => (
  <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">マイページ</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            登録情報と利用状況を確認できます。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LocaleLink
            className="inline-flex rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
            href="/my/library"
          >
            購入済み一覧
          </LocaleLink>
          <LocaleLink
            className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            href="/settings"
          >
            設定を開く
          </LocaleLink>
        </div>
      </div>
    </section>

    <Suspense fallback={<MyContentFallback />}>
      <MyContent />
    </Suspense>
  </div>
);

export default MyPage;
