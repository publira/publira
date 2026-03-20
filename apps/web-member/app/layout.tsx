import "./globals.css";
import { SiteLayout } from "@publira/layouts";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja">
      <body>
        <SiteLayout appLabel="Publira">{children}</SiteLayout>
      </body>
    </html>
  );
}
