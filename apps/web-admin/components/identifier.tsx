"use client";

// The copy control keeps state of its own, and `tsdown` drops the package's
// `"use client"`, so the directive has to come from a module of this app.
export {
  Identifier,
  IdentifierCopy,
  IdentifierValue,
} from "@publira/ui-components/identifier";
