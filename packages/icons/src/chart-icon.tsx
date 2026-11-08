import { ChartColumn } from "lucide-react";
import type { JSX } from "react";

import type { IconProps } from "./types";

export const ChartIcon = (props: IconProps): JSX.Element => (
  <ChartColumn {...props} />
);
