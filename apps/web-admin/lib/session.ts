import { cookies } from "next/headers";

import { ADMIN_SESSION_COOKIE_NAME } from "./admin-auth-shared";

export const getSessionId = async (): Promise<string> => {
  "use cache: private";

  const cookieStore = await cookies();
  return cookieStore.get(ADMIN_SESSION_COOKIE_NAME)?.value?.trim() ?? "";
};
