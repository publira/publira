export const episodeLoginHref = (
  seriesPublicId: string,
  episodePublicId: string
): string => {
  const returnTo = `/series/${seriesPublicId}/episodes/${episodePublicId}`;
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
};

export const episodeAccessGateCopy = (
  signedIn: boolean
): { description: string; title: string } => {
  if (signedIn) {
    return {
      description:
        "閲覧権限がありません。チケットの有効期限が切れているか、まだ付与されていません。購入済みの場合は、別のアカウントでログインしていないか確認してください。",
      title: "このエピソードは閲覧できません",
    };
  }

  return {
    description:
      "本文を読むには、ログインしたうえで購入するか、管理者からチケットを付与してもらう必要があります。",
    title: "このエピソードは有料です",
  };
};
