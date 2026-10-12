import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../app.module";

// Live-infra test: needs Postgres + Redis (deploy/docker-compose.yml).
// Runs only with INTEGRATION_TESTS=1 so plain `npm test` (and CI) stays hermetic.
const describeIntegration = process.env.INTEGRATION_TESTS ? describe : describe.skip;

describeIntegration("GET /api/v1/health (live infra)", () => {
  it("reports ok with real Postgres and Redis", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();

    await request(app.getHttpServer())
      .get("/api/v1/health")
      .expect(200)
      .expect((res) => {
        if (res.body.status !== "ok") throw new Error(`expected ok, got ${res.body.status}`);
      });

    await app.close();
  }, 30000);
});
