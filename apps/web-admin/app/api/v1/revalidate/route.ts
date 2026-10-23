import { handleRevalidateRequest } from "@publira/utils/revalidate";
import type { NextRequest } from "next/server";

export const POST = (request: NextRequest) => handleRevalidateRequest(request);
