import { Search } from "lucide-react";
import type { JSX } from "react";

import type { IconProps } from "./types";

export const SearchIcon = (props: IconProps): JSX.Element => (
  <Search {...props} />
);
