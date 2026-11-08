import { ExternalLink } from "lucide-react";
import type { JSX } from "react";

import type { IconProps } from "./types";

export const ExternalLinkIcon = (props: IconProps): JSX.Element => (
  <ExternalLink {...props} />
);
