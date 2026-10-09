import { getUser } from "@netlify/identity";
import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { usage } from "../../db/schema.js";

// Aggregate dashboard data for the creator. Restricted to Identity users with the "admin" role.
export default async () => {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!(user.roles ?? []).includes("admin")) return new Response("Forbidden", { status: 403 });
  const rows = await db.select({ data: usage.data }).from(usage);
  return Response.json(rows.map((r) => r.data));
};

export const config: Config = { path: "/api/admin/usage" };
