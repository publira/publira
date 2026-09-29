"use client";

import type { Locale } from "@publira/i18n";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Switch } from "@publira/ui-components/switch";
import { useEffect, useState, useTransition } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import {
  isBrowserPushSupported,
  readPushSubscription,
  subscribeToPush,
  toWebPushSubscriptionKeys,
} from "#lib/browser-push";
import {
  registerBrowserPushAction,
  unregisterBrowserPushAction,
} from "#lib/push-actions";

/**
 * `unavailable` covers both a browser with no Push API and one whose service
 * worker registration was refused — private browsing, a blocked worker. Neither
 * can be subscribed, and the reader can do nothing about either from here, so
 * the card is left out entirely rather than showing a switch that cannot move.
 */
type SubscriptionState = "checking" | "off" | "on" | "unavailable";

export const BrowserNotificationsCard = ({
  locale,
  tenantId,
  vapidPublicKey,
}: {
  locale: Locale;
  tenantId: string;
  vapidPublicKey: string;
}) => {
  const t = useClientMessages();
  const [state, setState] = useState<SubscriptionState>("checking");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Syncing with an external system: what this browser is subscribed to lives
  // in the Push API, and only the browser can be asked.
  useEffect(() => {
    let current = true;
    const read = async () => {
      if (!isBrowserPushSupported()) {
        setState("unavailable");
        return;
      }

      try {
        const subscription = await readPushSubscription();
        if (current) {
          setState(subscription ? "on" : "off");
        }
      } catch {
        if (current) {
          setState("unavailable");
        }
      }
    };

    void read();

    return () => {
      current = false;
    };
  }, []);

  const turnOn = async (): Promise<void> => {
    const subscription = await subscribeToPush(vapidPublicKey);
    if (subscription === "denied") {
      setErrorMessage(t("host.settings.browser_notifications_denied"));
      return;
    }
    if (subscription === "dismissed") {
      // Pointing at the browser's settings here would name a switch that is not
      // there: closing the prompt stores no decision. "Try again" is what the
      // reader can actually do, and pressing it asks them once more.
      setErrorMessage(t("host.settings.browser_notifications_failed"));
      return;
    }

    // Past this point the browser holds a subscription, and every way out that
    // does not end in a registration has to give it back: one the server has no
    // row for reads as a switch that is on while nothing is ever delivered.
    const keys = toWebPushSubscriptionKeys(subscription);
    if (!keys) {
      await subscription.unsubscribe();
      setErrorMessage(t("host.settings.browser_notifications_failed"));
      return;
    }

    let result: Awaited<ReturnType<typeof registerBrowserPushAction>>;
    try {
      result = await registerBrowserPushAction({ ...keys, locale, tenantId });
    } catch (error) {
      await subscription.unsubscribe();
      throw error;
    }
    if (!result.ok) {
      await subscription.unsubscribe();
      setErrorMessage(result.message);
      return;
    }

    setState("on");
  };

  const turnOff = async (): Promise<void> => {
    const subscription = await readPushSubscription();
    if (!subscription) {
      setState("off");
      return;
    }

    // The server first: a failure there leaves the switch on, which is what the
    // reader would still be subscribed to.
    const result = await unregisterBrowserPushAction({
      endpoint: subscription.endpoint,
      locale,
      tenantId,
    });
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }

    await subscription.unsubscribe();
    setState("off");
  };

  if (state === "unavailable") {
    return null;
  }

  const onCheckedChange = (checked: boolean): void => {
    setErrorMessage(null);
    startTransition(async () => {
      try {
        await (checked ? turnOn() : turnOff());
      } catch {
        // A push service that could not be reached, a worker that never became
        // active, or a failure the Action could not word. None of them leaves
        // the reader anything to read off the switch, so they are told the one
        // thing they can act on: it did not move, and they can try again.
        setErrorMessage(
          checked
            ? t("host.settings.browser_notifications_failed")
            : t("host.settings.browser_notifications_off_failed")
        );
      }
    });
  };

  return (
    <section className="border border-border bg-card p-6">
      <h2 className="mb-4 text-lg font-semibold">
        <ClientMessage message="host.settings.browser_notifications_heading" />
      </h2>
      <Field className="grid-cols-[auto_1fr] items-start gap-x-3">
        <Switch
          checked={state === "on"}
          className="row-span-2 mt-0.5"
          disabled={isPending || state === "checking"}
          onCheckedChange={onCheckedChange}
        />
        <FieldLabel className="text-sm">
          <ClientMessage message="host.settings.browser_notifications_label" />
        </FieldLabel>
        <FieldDescription className="col-start-2">
          <ClientMessage message="host.settings.browser_notifications_help" />
        </FieldDescription>
      </Field>
      {errorMessage ? (
        <FormMessage className="mt-4" variant="destructive">
          {errorMessage}
        </FormMessage>
      ) : null}
    </section>
  );
};
