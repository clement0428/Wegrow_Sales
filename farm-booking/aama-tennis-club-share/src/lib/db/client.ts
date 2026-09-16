import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

type Env = { DB: D1Database };

export async function getDb(): Promise<D1Database> {
  const { env } = await getCloudflareContext({ async: true });
  const db = (env as unknown as Env).DB;
  if (!db) throw new Error("D1 binding DB 不存在，請確認 wrangler.jsonc 與 initOpenNextCloudflareForDev()");
  return db;
}
