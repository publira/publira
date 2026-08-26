export const episodeLoginHref = (
  seriesPublicId: string,
  episodePublicId: string
): string => {
  const returnTo = `/series/${seriesPublicId}/episodes/${episodePublicId}`;
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
};

export const episodeAccessGateCopy = (
  signedIn: boolean,
  acceptsPayments: boolean
): { description: string; title: string } => {
  if (signedIn) {
    return {
      description: acceptsPayments
        ? "閲覧権限がありません。チケットの有効期限が切れているか、まだ付与されていません。購入済みの場合は、別のアカウントでログインしていないか確認してください。"
        : "現在このサイトでは購入手続きを利用できません。チケットの有効期限が切れているか、まだ付与されていないかを確認してください。",
      title: "このエピソードは閲覧できません",
    };
  }

  return {
    description: acceptsPayments
      ? "本文を読むには、ログインしたうえで購入するか、管理者からチケットを付与してもらう必要があります。"
      : "本文を読むには、ログインして管理者からチケットを付与してもらう必要があります。現在このサイトでは購入手続きを利用できません。",
    title: "このエピソードは有料です",
  };
};
