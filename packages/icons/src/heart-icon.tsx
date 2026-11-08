import { Heart } from "lucide-react";
import type { JSX } from "react";

import type { IconProps } from "./types";

export const HeartIcon = (props: IconProps): JSX.Element => (
  <Heart {...props} />
);
