import "./globals.css";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja">
      <body className="bg-background text-foreground">{children}</body>
    </html>
  );
}
