import { PlatformLayout } from "#components/platform-layout";

export default function ProtectedLayout({ children }: LayoutProps<"/">) {
  return <PlatformLayout>{children}</PlatformLayout>;
}
