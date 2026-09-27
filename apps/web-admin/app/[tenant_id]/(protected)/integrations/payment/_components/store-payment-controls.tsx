"use client";

import { Button } from "@publira/ui-components/button";
import { FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { Textarea } from "@publira/ui-components/textarea";
import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";

interface StoreEnabledContextValue {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

const StoreEnabledContext = createContext<StoreEnabledContextValue | null>(
  null
);

const useStoreEnabled = () => {
  const context = use(StoreEnabledContext);
  if (!context) {
    throw new Error("StoreEnabled slots must be rendered inside StoreEnabled.");
  }
  return context;
};

/**
 * Whether one store is switched on, which marks its credentials required.
 * Seeded once per mount; the form keys it by the saved settings.
 */
export const StoreEnabled = ({
  children,
  initialEnabled,
}: {
  children: ReactNode;
  initialEnabled: boolean;
}) => {
  const [enabled, setEnabled] = useState(initialEnabled);
  const context = useMemo(() => ({ enabled, setEnabled }), [enabled]);

  return <StoreEnabledContext value={context}>{children}</StoreEnabledContext>;
};

/** The store's switch, posted as `name`, with `children` beside it. */
export const StoreEnabledCheckbox = ({
  children,
  name,
}: {
  children: ReactNode;
  name: string;
}) => {
  const { enabled, setEnabled } = useStoreEnabled();

  return (
    <label className="inline-flex items-center gap-2 text-sm text-foreground">
      <input
        checked={enabled}
        name={name}
        onChange={(event) => {
          setEnabled(event.target.checked);
        }}
        type="checkbox"
      />
      {children}
    </label>
  );
};

/** A credential's label, marked required while its store is switched on. */
export const StoreEnabledLabel = ({ children }: { children: ReactNode }) => {
  const { enabled } = useStoreEnabled();

  return <FieldLabel required={enabled}>{children}</FieldLabel>;
};

type StoreKeyMode = "clear" | "keep" | "replace";

interface StoreKeyContextValue {
  accept: string;
  mode: StoreKeyMode;
  name: string;
  setMode: (mode: StoreKeyMode) => void;
}

const StoreKeyContext = createContext<StoreKeyContextValue | null>(null);

const useStoreKey = () => {
  const context = use(StoreKeyContext);
  if (!context) {
    throw new Error("StoreKey slots must be rendered inside StoreKey.");
  }
  return context;
};

/**
 * A stored key shows as its hint and can be replaced or removed; a key being
 * entered is a file or pasted text. The mode travels with the form so the
 * Action can tell "left as it is" from "removed".
 */
export const StoreKey = ({
  accept,
  children,
  configured,
  name,
}: {
  accept: string;
  children: ReactNode;
  configured: boolean;
  name: string;
}) => {
  const [mode, setMode] = useState<StoreKeyMode>(
    configured ? "keep" : "replace"
  );
  const context = useMemo(
    () => ({ accept, mode, name, setMode }),
    [accept, mode, name]
  );

  return (
    <StoreKeyContext value={context}>
      <input name={`${name}_mode`} type="hidden" value={mode} />
      <input
        name={`${name}_configured`}
        type="hidden"
        value={configured ? "1" : "0"}
      />
      {children}
    </StoreKeyContext>
  );
};

/** Renders its children while the key is in `mode`. */
export const StoreKeyWhile = ({
  children,
  mode,
}: {
  children: ReactNode;
  mode: StoreKeyMode;
}) => (useStoreKey().mode === mode ? children : null);

/** Switches the key to `mode`; `children` is the control's wording. */
export const StoreKeyModeButton = ({
  children,
  mode,
}: {
  children: ReactNode;
  mode: StoreKeyMode;
}) => {
  const { setMode } = useStoreKey();

  return (
    <Button
      onClick={() => {
        setMode(mode);
      }}
      type="button"
      variant="outline"
    >
      {children}
    </Button>
  );
};

/** The new key as a file, posted as `<name>_file`. */
export const StoreKeyFile = () => {
  const { accept, name } = useStoreKey();

  return <Input accept={accept} name={`${name}_file`} type="file" />;
};

/** The new key as pasted text, posted as `name`. */
export const StoreKeyText = () => {
  const { name } = useStoreKey();

  return (
    <Textarea
      autoComplete="off"
      className="text-xs"
      name={name}
      rows={4}
      spellCheck={false}
    />
  );
};
