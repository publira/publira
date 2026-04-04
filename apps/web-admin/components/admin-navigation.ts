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
        description: "レーベル情報の管理",
        href: "/labels",
        icon: CollectionIcon,
        label: "レーベル",
      },
      {
        description: "著者情報の管理",
        href: "/creators",
        icon: CollectionIcon,
        label: "著者",
      },
      {
        description: "作品の基本情報と公開設定",
        href: "/series",
        icon: CollectionIcon,
        label: "シリーズ",
      },
      {
        description: "個別ページの作成・編集・公開管理",
        href: "/pages",
        icon: CollectionIcon,
        label: "ページ",
      },
      {
        description: "お知らせ作成と配信の管理",
        href: "/notifications",
        icon: CollectionIcon,
        label: "通知",
      },
    ],
    title: "運用",
  },
  {
    items: [
      {
        description: "操作履歴の確認と追跡",
        href: "/audit-logs",
        icon: CollectionIcon,
        label: "監査ログ",
      },
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
