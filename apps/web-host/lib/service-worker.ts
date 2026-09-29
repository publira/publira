/**
 * The site's service worker: new-episode pushes and nothing else.
 *
 * Next.js compiles a worker referenced by `navigator.serviceWorker.register(new
 * URL(…, import.meta.url))` into `_next/static/service-worker/` and answers it
 * with `Service-Worker-Allowed: /`, which is what lets a script served from
 * under `_next` control the whole site. `lib/browser-push.ts` holds that
 * registration.
 *
 * It caches nothing. A reader offline has no episode to be told about, and a
 * cache here would answer tenant pages this worker cannot tell apart.
 */

import type { PushWorkerScope } from "./service-worker-handlers";
import { registerPushHandlers } from "./service-worker-handlers";

registerPushHandlers(self as unknown as PushWorkerScope);
