import { Message } from "#components/message";
import type { ApiKeyScopeValue } from "#lib/api-keys";

/**
 * A scope's name, worded one branch at a time so each key stays where
 * anything reading this file for the screen's strings can see it.
 */
export const ApiKeyScopeLabel = ({ scope }: { scope: ApiKeyScopeValue }) => {
  switch (scope) {
    case "catalog": {
      return <Message message="admin.settings.api_keys.scopes.catalog_label" />;
    }

    case "purchases": {
      return (
        <Message message="admin.settings.api_keys.scopes.purchases_label" />
      );
    }

    default: {
      return null;
    }
  }
};
