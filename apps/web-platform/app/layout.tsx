import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "Publira Platform Console",
    template: "%s | Publira Platform Console",
  },
};

const RootLayout = ({ children }: LayoutProps<"/">) => (
  <html lang="ja">
    <body className="min-h-dvh antialiased">{children}</body>
  </html>
);

export default RootLayout;
