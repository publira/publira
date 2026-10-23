"use client";

import * as Identifier from "@publira/ui-components/identifier";
import { Input } from "@publira/ui-components/input";
import { RadioGroup } from "@publira/ui-components/radio-group";
import type { RadioGroupProps } from "@publira/ui-components/radio-group";
import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { useClientMessages } from "#components/client-message";
import { isGoogleTagServingMode } from "#lib/tenant-analytics-settings-shared";
import type { GoogleTagServingMode } from "#lib/tenant-analytics-settings-shared";

interface GoogleTagModeContextValue {
  servingMode: GoogleTagServingMode;
  serverContainerUrl: string;
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
 * Holds the mode and the server container URL the form saves, so the URL
 * survives switching back and forth while its field comes and goes with the
 * mode.
 */
export const GoogleTagModeScope = ({
  children,
  initialServerContainerUrl,
  initialServingMode,
}: {
  children: ReactNode;
  initialServerContainerUrl: string;
  initialServingMode: GoogleTagServingMode;
}) => {
  const [servingMode, setServingMode] = useState(initialServingMode);
  const [serverContainerUrl, setServerContainerUrl] = useState(
    initialServerContainerUrl
  );
  const context = useMemo(
    () => ({
      serverContainerUrl,
      servingMode,
      setServerContainerUrl,
      setServingMode,
    }),
    [serverContainerUrl, servingMode]
  );

  return (
    <GoogleTagModeContext value={context}>
      <input name="serving_mode" type="hidden" value={servingMode} />
      {children}
    </GoogleTagModeContext>
  );
};

/** The mode picker; `items` carry the rendered wording of each mode. */
export const GoogleTagModeRadioGroup = ({
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
export const GoogleTagModeWhile = ({
  children,
  mode,
}: {
  children: ReactNode;
  mode: GoogleTagServingMode;
}) => (useGoogleTagMode().servingMode === mode ? children : null);

/**
 * The server container URL. It is posted only while it is rendered, so a mode
 * without this field saves the URL cleared.
 */
export const ServerContainerUrlInput = () => {
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

/** Copies the gateway path, named for a screen reader. */
export const GatewayPathCopy = ({ value }: { value: string }) => {
  const t = useClientMessages();

  return (
    <Identifier.Copy
      aria-label={t("admin.settings.google_tag.gateway_path_copy")}
      value={value}
    />
  );
};
