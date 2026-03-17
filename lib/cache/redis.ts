import debugLib from "debug";
import { createClient } from "redis";

const dbg = debugLib("cache:redis");

let client: ReturnType<typeof createClient> | null = null;

export function getRedis() {
  if (client) {
    return client;
  }
  const url = process.env.REDIS_URL;
  if (!url) {
    return null; // optional cache
  }
  client = createClient({ url });
  client.on("error", (err) => {
    dbg("Redis error: %O", err);
  });
  client.connect().catch((err) => {
    dbg("Redis connection error: %O", err);
  });
  return client;
}

export async function cacheGet(key: string): Promise<string | null> {
  const r = getRedis();
  if (!r) {
    return null;
  }
  try {
    return await r.get(key);
  } catch (err) {
    dbg("cacheGet error for key %s: %O", key, err);
    return null;
  }
}

export async function cacheSet(
  key: string,
  value: string,
  ttlSeconds?: number
) {
  const r = getRedis();
  if (!r) {
    return;
  }
  try {
    if (ttlSeconds && ttlSeconds > 0) {
      await r.setEx(key, ttlSeconds, value);
    } else {
      await r.set(key, value);
    }
  } catch (err) {
    dbg("cacheSet error for key %s: %O", key, err);
  }
}
