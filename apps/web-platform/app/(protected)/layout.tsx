import { PlatformLayout } from "#components/platform-layout";

const ProtectedLayout = ({ children }: LayoutProps<"/">) => (
  <PlatformLayout>{children}</PlatformLayout>
);

export default ProtectedLayout;
