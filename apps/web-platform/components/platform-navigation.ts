import { CollectionIcon, DashboardIcon, SettingsIcon } from "@publira/icons";
import type { NavSection } from "@publira/layouts/navigation";

export const navigation: NavSection[] = [
  {
    items: [
      {
        description: "プラットフォーム全体の稼働状況を確認",
        href: "/",
        icon: DashboardIcon,
        label: "ダッシュボード",
      },
    ],
    title: "Overview",
  },
  {
    items: [
      {
        description: "テナントの状態・プラン・連絡先を横断管理",
        href: "/tenants",
        icon: CollectionIcon,
        label: "テナント一覧",
      },
      {
        description: "新規テナントを発行して初期設定を開始",
        href: "/tenants/new",
        icon: CollectionIcon,
        label: "テナント作成",
      },
    ],
    title: "Tenants",
  },
  {
    items: [
      {
        description: "プラットフォーム運用者のロールと権限を管理",
        href: "/operators",
        icon: SettingsIcon,
        label: "オペレーター管理",
      },
      {
        description: "ユーザーの状態確認とアカウント管理",
        href: "/users",
        icon: SettingsIcon,
        label: "ユーザー管理",
      },
      {
        description: "横断監査ログを検索して変更履歴を追跡",
        href: "/audit-logs",
        icon: SettingsIcon,
        label: "監査ログ",
      },
    ],
    title: "Governance",
  },
];
