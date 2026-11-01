import type { CnFunction } from "cn";
import { createCn } from "cn/config";

import { cnConfigExtension } from "./cn-config";

export const cn: CnFunction = createCn(cnConfigExtension);
