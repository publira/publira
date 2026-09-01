import { Code, ConnectError } from "@connectrpc/connect";
import type { ConnectRouter } from "@connectrpc/connect";
import { EmailRendererService } from "@publira/api-client/email/renderer";
import { loadEmailMessages, renderEmail } from "@publira/email-templates";
import { parseLocale } from "@publira/i18n";

export const emailRendererRoutes = (router: ConnectRouter): void => {
  router.service(EmailRendererService, {
    renderEmail: async (request) => {
      // The queued job states the recipient's locale. One this build does not
      // serve is a bad request, not an email to send in another language.
      const locale = parseLocale(request.locale);
      if (locale === undefined) {
        throw new ConnectError(
          `unsupported locale: ${request.locale}`,
          Code.InvalidArgument
        );
      }

      const messages = await loadEmailMessages(locale);
      const rendered = await renderEmail({
        data: request.data ?? {},
        locale,
        messages,
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
