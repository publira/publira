import { Coins } from "lucide-react";
import type { JSX } from "react";

import type { IconProps } from "./types";

export const CoinsIcon = (props: IconProps): JSX.Element => (
  <Coins {...props} />
);
