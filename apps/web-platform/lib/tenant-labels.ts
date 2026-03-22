export type TenantStatusTone = "destructive" | "info" | "success";

export const getTenantStatusLabel = (status: string): string => {
  switch (status) {
    case "active": {
      return "稼働中";
    }
    case "inactive": {
      return "無効";
    }
    case "suspended": {
      return "停止中";
    }
    case "trial": {
      return "トライアル";
    }
    default: {
      return status;
    }
  }
};

export const getTenantStatusTone = (status: string): TenantStatusTone => {
  switch (status) {
    case "active": {
      return "success";
    }
    case "suspended": {
      return "destructive";
    }
    default: {
      return "info";
    }
  }
};

export const getTenantRoleLabel = (role: string): string => {
  switch (role) {
    case "tenant_admin": {
      return "テナント管理者";
    }
    case "tenant_editor": {
      return "編集担当";
    }
    case "tenant_member": {
      return "メンバー";
    }
    case "tenant_owner": {
      return "オーナー";
    }
    default: {
      return role;
    }
  }
};
