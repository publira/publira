import { Code, ConnectError } from "@connectrpc/connect";
import type { ConnectRouter } from "@connectrpc/connect";
import { EmailRendererService } from "@publira/api-client/email/renderer";
import { loadEmailMessages, renderEmail } from "@publira/email-templates";

export const emailRendererRoutes = (router: ConnectRouter): void => {
  router.service(EmailRendererService, {
    renderEmail: async (request) => {
      const rendered = await renderEmail({
        data: request.data ?? {},
        locale: request.locale,
        messages: await loadEmailMessages(request.locale),
        template: request.template,
        timeZone: request.timeZone,
      });

      if (!rendered.ok) {
        throw new ConnectError(rendered.message, Code.InvalidArgument);
      }

      return {
        html: rendered.html,
        subject: rendered.subject,
        text: rendered.text,
      };
    },
  });
};
