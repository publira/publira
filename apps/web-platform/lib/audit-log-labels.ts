const auditActionLabelMap = {
  creator_created: "作者を作成",
  creator_updated: "作者を更新",
  episode_created: "エピソードを作成",
  episode_image_uploaded: "エピソード画像をアップロード",
  episode_updated: "エピソードを更新",
  label_created: "ラベルを作成",
  label_updated: "ラベルを更新",
  operator_created: "オペレーターを作成",
  operator_deleted: "オペレーターを削除",
  operator_resumed: "オペレーターを再開",
  operator_suspended: "オペレーターを停止",
  operator_updated: "オペレーターを更新",
  series_created: "シリーズを作成",
  series_updated: "シリーズを更新",
  tenant_created: "テナントを作成",
  tenant_info_updated: "テナント情報を更新",
  tenant_resumed: "テナントを再開",
  tenant_suspended: "テナントを停止",
  user_activated: "ユーザーを有効化",
  user_deleted: "ユーザーを削除",
  user_suspended: "ユーザーを停止",
} as const;

export const auditActionOptions = Object.entries(auditActionLabelMap)
  .map(([value, label]) => ({ label, value }))
  .toSorted((left, right) => left.label.localeCompare(right.label, "ja"));

export const getAuditActionLabel = (action: string): string => {
  const normalized = action.trim();
  if (!normalized) {
    return "未設定";
  }

  return (
    auditActionLabelMap[normalized as keyof typeof auditActionLabelMap] ??
    normalized
  );
};
