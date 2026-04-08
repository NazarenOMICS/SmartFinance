export function jsonError(message: string, code: string, requestId: string, status: number) {
  return new Response(
    JSON.stringify({
      error: message,
      code,
      request_id: requestId,
    }),
    {
      status,
      headers: {
        "content-type": "application/json",
      },
    },
  );
}

