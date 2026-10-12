import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../app.module";

describe("GET /api/v1/health", () => {
  it("returns 200 without external dependencies", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();

    await request(app.getHttpServer())
      .get("/api/v1/health")
      .expect(200)
      .expect((res) => {
        if (res.body.status !== "ok") throw new Error("expected status ok");
        if (res.body.trading !== "disabled") throw new Error("trading must default to disabled");
        if (typeof res.body.version !== "string") throw new Error("expected version string");
      });

    await app.close();
  });
});
