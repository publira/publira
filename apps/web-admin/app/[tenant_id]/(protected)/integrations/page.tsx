import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import { redirect } from "next/navigation";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

/** The sidebar entry opens on the first tab. */
const IntegrationsPage = () => {
  redirect("/integrations/email");
};

export default IntegrationsPage;
