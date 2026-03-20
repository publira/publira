import "./globals.css";
import { AdminLayout } from "../components/admin-layout";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja">
      <body className="min-h-dvh antialiased">
        <AdminLayout>{children}</AdminLayout>
      </body>
    </html>
  );
}
