import { Link } from "lucide-react";
import type { JSX } from "react";

import type { IconProps } from "./types";

export const LinkIcon = (props: IconProps): JSX.Element => <Link {...props} />;
