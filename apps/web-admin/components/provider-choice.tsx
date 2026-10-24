"use client";
import { Select } from "@publira/ui-components/select";
import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";

interface ProviderChoiceContextValue {
  credentialsProvider: string;
  provider: string;
  setProvider: (provider: string) => void;
}

const ProviderChoiceContext = createContext<ProviderChoiceContextValue | null>(
  null
);

const useProviderChoice = () => {
  const context = use(ProviderChoiceContext);
  if (!context) {
    throw new Error(
      "ProviderChoice slots must be rendered inside ProviderChoice."
    );
  }
  return context;
};

/**
 * The provider being configured, which decides whose credential fields and
 * webhook URL are shown. Seeded once per mount; the form keys it by the saved
 * settings.
 */
const ProviderChoice = ({
  children,
  credentialsProvider,
  initialProvider,
}: {
  children: ReactNode;
  /** The provider whose credentials are stored, or empty when none are. */
  credentialsProvider: string;
  initialProvider: string;
}) => {
  const [provider, setProvider] = useState(initialProvider);
  const context = useMemo(
    () => ({ credentialsProvider, provider, setProvider }),
    [credentialsProvider, provider]
  );

  return (
    <ProviderChoiceContext value={context}>{children}</ProviderChoiceContext>
  );
};

/** The select, posted as `provider`. Each option is the provider's own name. */
const ProviderChoiceSelect = ({
  providers,
}: {
  providers: readonly { displayName: string; id: string }[];
}) => {
  const { provider, setProvider } = useProviderChoice();

  return (
    <>
      <Select
        disabled={providers.length === 0}
        items={providers.map((candidate) => ({
          label: candidate.displayName,
          value: candidate.id,
        }))}
        onValueChange={setProvider}
        value={provider}
      />
      <input name="provider" type="hidden" value={provider} />
    </>
  );
};

/** Renders its children while `provider` is the one chosen. */
const ProviderChoicePanel = ({
  children,
  provider,
}: {
  children: ReactNode;
  provider: string;
}) => (useProviderChoice().provider === provider ? children : null);

/**
 * Renders its children while the chosen provider is not the one whose
 * credentials are stored, which a save would clear.
 */
const ProviderChoiceChangeNotice = ({ children }: { children: ReactNode }) => {
  const { credentialsProvider, provider } = useProviderChoice();

  return credentialsProvider !== "" && provider !== credentialsProvider
    ? children
    : null;
};

export {
  ProviderChoice as Root,
  ProviderChoiceChangeNotice as ChangeNotice,
  ProviderChoicePanel as Panel,
  ProviderChoiceSelect as Select,
};
