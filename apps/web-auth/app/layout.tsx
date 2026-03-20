import "./globals.css";
import { SiteLayout } from "@publira/layouts";
import Link from "next/link";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja">
      <body>
        <SiteLayout
          appLabel="Publira Auth"
          linkComponent={Link}
          primaryAction={{ href: "/signup", label: "新規登録" }}
          secondaryAction={{ href: "/login", label: "ログイン" }}
        >
          {children}
        </SiteLayout>
      </body>
    </html>
  );
}
