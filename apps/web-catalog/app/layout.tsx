import "./globals.css";
import { SiteLayout } from "@publira/layouts";
import Link from "next/link";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja">
      <body>
        <SiteLayout appLabel="Publira Catalog" linkComponent={Link}>
          {children}
        </SiteLayout>
      </body>
    </html>
  );
}
