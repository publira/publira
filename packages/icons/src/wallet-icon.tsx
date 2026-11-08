import { Wallet } from "lucide-react";
import type { JSX } from "react";

import type { IconProps } from "./types";

export const WalletIcon = (props: IconProps): JSX.Element => (
  <Wallet {...props} />
);
