// Per-IP token bucket for the public MCP endpoint.
// 60 requests per rolling 5-minute window.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQ = 60;

export async function checkRateLimit(ip: string): Promise<{ ok: boolean; remaining: number }> {
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS).toISOString();

  // Upsert by (ip, window_start)
  const { data: existing } = await supabaseAdmin
    .from("rate_limits")
    .select("count")
    .eq("ip", ip)
    .eq("window_start", windowStart)
    .maybeSingle();

  const current = existing?.count ?? 0;
  if (current >= MAX_REQ) return { ok: false, remaining: 0 };

  if (existing) {
    await supabaseAdmin
      .from("rate_limits")
      .update({ count: current + 1 })
      .eq("ip", ip)
      .eq("window_start", windowStart);
  } else {
    await supabaseAdmin.from("rate_limits").insert({ ip, window_start: windowStart, count: 1 });
    // Occasionally GC old buckets
    if (Math.random() < 0.05) {
      const cutoff = new Date(now.getTime() - WINDOW_MS * 3).toISOString();
      await supabaseAdmin.from("rate_limits").delete().lt("window_start", cutoff);
    }
  }
  return { ok: true, remaining: MAX_REQ - current - 1 };
}

export function getClientIp(request: Request): string {
  const xf = request.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip") ?? "unknown";
}
