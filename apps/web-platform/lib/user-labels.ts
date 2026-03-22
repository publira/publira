export type EndUserStatusTone = "destructive" | "info" | "success";

export const getEndUserStatusLabel = (status: string): string => {
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

export const getEndUserStatusTone = (status: string): EndUserStatusTone => {
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
