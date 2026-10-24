"use client";

import { Button } from "@publira/ui-components/button";
import { Input } from "@publira/ui-components/input";
import { Textarea } from "@publira/ui-components/textarea";
import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";

type SecretKeyMode = "clear" | "keep" | "replace";

interface SecretKeyContextValue {
  accept: string;
  mode: SecretKeyMode;
  name: string;
  setMode: (mode: SecretKeyMode) => void;
}

const SecretKeyContext = createContext<SecretKeyContextValue | null>(null);

const useSecretKey = () => {
  const context = use(SecretKeyContext);
  if (!context) {
    throw new Error("SecretKey slots must be rendered inside SecretKey.");
  }
  return context;
};

/**
 * A stored key shows as its hint and can be replaced or removed; a key being
 * entered is a file or pasted text. The mode travels with the form so the
 * Action can tell "left as it is" from "removed".
 */
const SecretKey = ({
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
  const [mode, setMode] = useState<SecretKeyMode>(
    configured ? "keep" : "replace"
  );
  const context = useMemo(
    () => ({ accept, mode, name, setMode }),
    [accept, mode, name]
  );

  return (
    <SecretKeyContext value={context}>
      <input name={`${name}_mode`} type="hidden" value={mode} />
      <input
        name={`${name}_configured`}
        type="hidden"
        value={configured ? "1" : "0"}
      />
      {children}
    </SecretKeyContext>
  );
};

/** Renders its children while the key is in `mode`. */
const SecretKeyWhile = ({
  children,
  mode,
}: {
  children: ReactNode;
  mode: SecretKeyMode;
}) => (useSecretKey().mode === mode ? children : null);

/** Switches the key to `mode`; `children` is the control's wording. */
const SecretKeyModeButton = ({
  children,
  mode,
}: {
  children: ReactNode;
  mode: SecretKeyMode;
}) => {
  const { setMode } = useSecretKey();

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
const SecretKeyFile = () => {
  const { accept, name } = useSecretKey();

  return <Input accept={accept} name={`${name}_file`} type="file" />;
};

/** The new key as pasted text, posted as `name`. */
const SecretKeyText = () => {
  const { name } = useSecretKey();

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

export {
  SecretKey as Root,
  SecretKeyFile as File,
  SecretKeyModeButton as ModeButton,
  SecretKeyText as Text,
  SecretKeyWhile as While,
};
