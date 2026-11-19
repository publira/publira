"use client";

import { Input } from "@publira/ui-components/input";
import { RadioGroup } from "@publira/ui-components/radio-group";
import type { RadioGroupProps } from "@publira/ui-components/radio-group";
import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  isGoogleTagConsentMode,
  isGoogleTagServingMode,
} from "#lib/tenant-analytics-settings-shared";
import type {
  GoogleTagConsentMode,
  GoogleTagServingMode,
} from "#lib/tenant-analytics-settings-shared";

interface GoogleTagModeContextValue {
  consentMode: GoogleTagConsentMode;
  gtmContainerId: string;
  servingMode: GoogleTagServingMode;
  serverContainerUrl: string;
  setConsentMode: (mode: GoogleTagConsentMode) => void;
  setGtmContainerId: (id: string) => void;
  setServingMode: (mode: GoogleTagServingMode) => void;
  setServerContainerUrl: (url: string) => void;
}

const GoogleTagModeContext = createContext<GoogleTagModeContextValue | null>(
  null
);

const useGoogleTagMode = () => {
  const context = use(GoogleTagModeContext);

  if (!context) {
    throw new Error("Rendered outside a GoogleTagModeScope.");
  }

  return context;
};

/**
 * Holds the modes, the container ID, and the server container URL the form
 * saves, so the URL survives switching back and forth while its field comes and
 * goes with the mode, and the consent mode that needs a container can tell
 * whether one is entered.
 */
const GoogleTagModeScope = ({
  children,
  initialConsentMode,
  initialGtmContainerId,
  initialServerContainerUrl,
  initialServingMode,
}: {
  children: ReactNode;
  initialConsentMode: GoogleTagConsentMode;
  initialGtmContainerId: string;
  initialServerContainerUrl: string;
  initialServingMode: GoogleTagServingMode;
}) => {
  const [servingMode, setServingMode] = useState(initialServingMode);

  const [serverContainerUrl, setServerContainerUrl] = useState(
    initialServerContainerUrl
  );

  const [consentMode, setConsentMode] = useState(initialConsentMode);
  const [gtmContainerId, setGtmContainerId] = useState(initialGtmContainerId);

  const context = useMemo(
    () => ({
      consentMode,
      gtmContainerId,
      serverContainerUrl,
      servingMode,
      setConsentMode,
      setGtmContainerId,
      setServerContainerUrl,
      setServingMode,
    }),
    [consentMode, gtmContainerId, serverContainerUrl, servingMode]
  );

  return (
    <GoogleTagModeContext value={context}>
      <input name="serving_mode" type="hidden" value={servingMode} />
      <input name="consent_mode" type="hidden" value={consentMode} />
      {children}
    </GoogleTagModeContext>
  );
};

/** The mode picker; `items` carry the rendered wording of each mode. */
const GoogleTagModeRadioGroup = ({
  items,
}: {
  items: RadioGroupProps["items"];
}) => {
  const { servingMode, setServingMode } = useGoogleTagMode();

  return (
    <RadioGroup
      items={items}
      onValueChange={(value) => {
        if (isGoogleTagServingMode(value)) {
          setServingMode(value);
        }
      }}
      value={servingMode}
    />
  );
};

/** Renders its children only while `mode` is the one chosen. */
const GoogleTagModeWhile = ({
  children,
  mode,
}: {
  children: ReactNode;
  mode: GoogleTagServingMode;
}) => (useGoogleTagMode().servingMode === mode ? children : null);

/** The Tag Manager container ID, which decides whether `external` can be chosen. */
const GoogleTagModeContainerIdInput = () => {
  const { gtmContainerId, setGtmContainerId } = useGoogleTagMode();

  return (
    <Input
      autoCapitalize="characters"
      autoComplete="off"
      name="gtm_container_id"
      onValueChange={setGtmContainerId}
      placeholder="GTM-XXXXXXX"
      spellCheck={false}
      type="text"
      value={gtmContainerId}
    />
  );
};

/** Whether a container ID is entered, which `external` needs. */
const useHasContainerId = () => useGoogleTagMode().gtmContainerId.trim() !== "";

/**
 * The consent picker; `items` carry the rendered wording of each mode. With no
 * container ID entered, `external` is disabled, as the API refuses it then. A
 * saved `external` stays chosen while the ID is cleared, so the save is refused
 * next to the ID rather than switching the tenant's choice behind its back.
 */
const GoogleTagConsentRadioGroup = ({
  items,
}: {
  items: RadioGroupProps["items"];
}) => {
  const { consentMode, setConsentMode } = useGoogleTagMode();
  const hasContainerId = useHasContainerId();

  return (
    <RadioGroup
      items={items.map((item) =>
        item.value === "external" && !hasContainerId
          ? { ...item, disabled: true }
          : item
      )}
      onValueChange={(value) => {
        if (isGoogleTagConsentMode(value)) {
          setConsentMode(value);
        }
      }}
      value={consentMode}
    />
  );
};

/** Renders its children only while a container ID is entered. */
const GoogleTagModeWithContainerId = ({ children }: { children: ReactNode }) =>
  useHasContainerId() ? children : null;

/** Renders its children only while no container ID is entered. */
const GoogleTagModeWithoutContainerId = ({
  children,
}: {
  children: ReactNode;
}) => (useHasContainerId() ? null : children);

/** Renders its children only while `mode` is the consent mode chosen. */
const GoogleTagConsentWhile = ({
  children,
  mode,
}: {
  children: ReactNode;
  mode: GoogleTagConsentMode;
}) => (useGoogleTagMode().consentMode === mode ? children : null);

/**
 * The server container URL. It is posted only while it is rendered, so a mode
 * without this field saves the URL cleared.
 */
const GoogleTagModeServerContainerUrlInput = () => {
  const { serverContainerUrl, setServerContainerUrl } = useGoogleTagMode();

  return (
    <Input
      autoCapitalize="off"
      autoComplete="off"
      inputMode="url"
      name="server_container_url"
      onValueChange={setServerContainerUrl}
      placeholder="https://sgtm.example.com"
      spellCheck={false}
      type="text"
      value={serverContainerUrl}
    />
  );
};

export {
  GoogleTagConsentRadioGroup as ConsentRadioGroup,
  GoogleTagConsentWhile as WhileConsent,
  GoogleTagModeContainerIdInput as ContainerIdInput,
  GoogleTagModeScope as Root,
  GoogleTagModeRadioGroup as RadioGroup,
  GoogleTagModeServerContainerUrlInput as ServerContainerUrlInput,
  GoogleTagModeWhile as While,
  GoogleTagModeWithContainerId as WithContainerId,
  GoogleTagModeWithoutContainerId as WithoutContainerId,
};
