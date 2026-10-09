import { eq } from "drizzle-orm";
import { getUser } from "@netlify/identity";
import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { usage } from "../../db/schema.js";

// The signed-in user's own anonymous usage document.
export default async (req: Request) => {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  if (req.method === "GET") {
    const [row] = await db.select().from(usage).where(eq(usage.userId, user.id));
    return Response.json({
      exists: !!row,
      data: row?.data ?? null,
    });
  }

  if (req.method === "PUT") {
    const body = await req.text();
    if (body.length > 100_000) return new Response("Too large", { status: 413 });
    let data: unknown;
    try { data = JSON.parse(body); } catch { return new Response("Bad JSON", { status: 400 }); }
    if (!data || typeof data !== "object" || Array.isArray(data)) return new Response("Bad data", { status: 400 });
    await db
      .insert(usage)
      .values({ userId: user.id, data })
      .onConflictDoUpdate({ target: usage.userId, set: { data, updatedAt: new Date() } });
    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = { path: "/api/usage" };
