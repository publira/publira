import { PlatformLayout } from "#components/platform-layout";

const ProtectedLayout = ({ children }: LayoutProps<"/[locale]">) => (
  <PlatformLayout>{children}</PlatformLayout>
);

export default ProtectedLayout;
