import { createClient } from "@supabase/supabase-js";
import { runSmokeTests } from "/dev-server/src/lib/ingest-smoke.server.ts";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const report = await runSmokeTests(sb);
await sb.from("ingest_runs").insert({ kind: "smoke", finished_at: new Date().toISOString(), notes: report.summary });
console.log(JSON.stringify(report, null, 2));
