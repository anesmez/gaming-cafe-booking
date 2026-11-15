import { getAuth } from "@/server/auth";

/** Auth library endpoints (session, sign-out, email code). */
async function handle(request: Request): Promise<Response> {
  try {
    const auth = await getAuth();
    return await auth.handler(request);
  } catch (error) {
    console.error("auth handler unavailable:", error instanceof Error ? error.message : error);
    return Response.json({ error: "AUTH_UNAVAILABLE" }, { status: 503 });
  }
}

export { handle as GET, handle as POST };
