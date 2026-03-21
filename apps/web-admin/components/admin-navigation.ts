import { CollectionIcon, DashboardIcon, SettingsIcon } from "@publira/icons";
import type { NavSection } from "@publira/layouts/navigation";

export const navigation: NavSection[] = [
  {
    items: [
      {
        description: "公開準備と編集状況の概況",
        href: "/",
        icon: DashboardIcon,
        label: "ダッシュボード",
      },
      {
        description: "作品の基本情報と公開設定",
        href: "/series",
        icon: CollectionIcon,
        label: "シリーズ",
      },
    ],
    title: "運用",
  },
  {
    items: [
      {
        description: "ブランドと運用ルールの管理",
        href: "/settings",
        icon: SettingsIcon,
        label: "設定",
      },
    ],
    title: "管理",
  },
];
