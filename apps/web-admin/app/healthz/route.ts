export const GET = () =>
  new Response("ok", {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
    status: 200,
  });
