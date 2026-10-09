import Anthropic from "@anthropic-ai/sdk";
import { getUser } from "@netlify/identity";
import type { Config } from "@netlify/functions";

const anthropic = new Anthropic();
const MODEL = "claude-sonnet-5-5";

// Automatic generation for logged-in pilot users. The prompt is built client-side
// (SOAP rules, library prompts) and returned here as raw model text; the client parses the JSON.
export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const user = await getUser();
  if (!user) return Response.json({ code: "not_granted" }, { status: 401 });

  let prompt = "";
  try { prompt = String((await req.json()).prompt || ""); } catch { /* handled below */ }
  if (!prompt || prompt.length > 60000) return Response.json({ code: "bad_request" }, { status: 400 });

  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt + "\n\nIMPORTANT: Reply with the JSON object only. No explanation and no markdown fences." }],
    });
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return Response.json({ text });
  } catch (e: any) {
    const status = e?.status === 429 ? 429 : 502;
    return Response.json({ code: status === 429 ? "rate_limited" : "ai_error" }, { status });
  }
};

export const config: Config = { path: "/api/ai" };
