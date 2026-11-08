import { Settings } from "lucide-react";
import type { JSX } from "react";

import type { IconProps } from "./types";

export const SettingsIcon = (props: IconProps): JSX.Element => (
  <Settings {...props} />
);
