import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../app.module";
import { PrismaService } from "../database/prisma.service";
import { OUTBOX_QUEUE } from "../queue/queue.module";
import { REDIS_CLIENT } from "../queue/redis.provider";

function buildModule(prisma: unknown, redis: unknown) {
  return Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .overrideProvider(REDIS_CLIENT)
    .useValue(redis)
    .overrideProvider(OUTBOX_QUEUE)
    .useValue({ close: async () => {} })
    .compile();
}

describe("GET /api/v1/health", () => {
  it("returns ok when all dependencies are up", async () => {
    const moduleRef = await buildModule(
      { $queryRaw: async () => [{ "?column?": 1 }] },
      { ping: async () => "PONG", disconnect: () => {} },
    );
    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();

    await request(app.getHttpServer())
      .get("/api/v1/health")
      .expect(200)
      .expect((res) => {
        if (res.body.status !== "ok") throw new Error("expected status ok");
        if (res.body.trading !== "disabled") throw new Error("trading must default to disabled");
        if (res.body.deps.db !== "up" || res.body.deps.redis !== "up") {
          throw new Error("expected all deps up");
        }
      });

    await app.close();
  });

  it("returns degraded when a dependency is down", async () => {
    const moduleRef = await buildModule(
      {
        $queryRaw: async () => {
          throw new Error("db down");
        },
      },
      { ping: async () => "PONG", disconnect: () => {} },
    );
    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();

    await request(app.getHttpServer())
      .get("/api/v1/health")
      .expect(200)
      .expect((res) => {
        if (res.body.status !== "degraded") throw new Error("expected degraded");
        if (res.body.deps.db !== "down") throw new Error("expected db down");
      });

    await app.close();
  });
});
