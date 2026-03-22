export type OperatorRoleTone = "info";

export const getOperatorRoleLabel = (role: string): string => {
  switch (role) {
    case "platform_auditor": {
      return "監査担当";
    }
    case "platform_operator": {
      return "オペレーター";
    }
    case "platform_super_admin": {
      return "スーパー管理者";
    }
    default: {
      return role;
    }
  }
};

export const getOperatorStatusLabel = (status: string): string => {
  switch (status) {
    case "active": {
      return "有効";
    }
    case "inactive": {
      return "無効";
    }
    case "suspended": {
      return "停止中";
    }
    default: {
      return status;
    }
  }
};

export const getOperatorRoleCardDescription = ({
  isSelf,
  isSuperAdmin,
}: {
  isSelf: boolean;
  isSuperAdmin: boolean;
}): string => {
  if (isSelf) {
    return "自分自身のロールは変更できません。";
  }
  if (!isSuperAdmin) {
    return "ロールの変更はスーパー管理者のみ実行できます。";
  }
  return "オペレーターのロールを変更します。";
};
