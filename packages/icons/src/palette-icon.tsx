import { Palette } from "lucide-react";
import type { JSX } from "react";

import type { IconProps } from "./types";

export const PaletteIcon = (props: IconProps): JSX.Element => (
  <Palette {...props} />
);
