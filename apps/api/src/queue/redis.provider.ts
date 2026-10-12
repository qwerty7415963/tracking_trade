import Redis from "ioredis";

export const REDIS_CLIENT = "REDIS_CLIENT";

export function createRedisClient(url: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    enableReadyCheck: false,
    // Required by BullMQ.
    maxRetriesPerRequest: null,
  });
}
