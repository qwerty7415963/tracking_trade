import { Test } from "@nestjs/testing";
import { AppModule } from "../app.module";
import { PrismaService } from "../database/prisma.service";
import { TelegramCollectorService } from "../telegram/telegram-collector.service";
import { SourcesService } from "./sources.service";

// Live-DB test: needs Postgres (deploy/docker-compose.yml).
// Runs only with INTEGRATION_TESTS=1 so plain `npm test` (and CI) stays hermetic.
const describeIntegration = process.env.INTEGRATION_TESTS ? describe : describe.skip;

describeIntegration("Sources + ingest (live DB)", () => {
  it("CRUD with soft delete, and ingest dedupes repeats", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const sources = app.get(SourcesService);
    const prisma = app.get(PrismaService);
    const telegram = new TelegramCollectorService(
      prisma,
      { operatorUsernames: [], tradingEnabled: false, databaseUrl: "", redisUrl: "" },
      () => {
        throw new Error("no live telegram in tests");
      },
    );

    const created = await sources.create(
      { platform: "TELEGRAM", externalSourceId: "itest-chan", displayName: "IT", sourceKind: "SIGNAL" },
      "tester",
    );
    expect((await sources.list()).some((s) => s.id === created.id)).toBe(true);

    await sources.setEnabled(created.id, false, "tester");
    expect((await sources.get(created.id)).enabled).toBe(false);

    const input = { id: "m1", text: "BUY XAUUSD" };
    const first = await telegram.ingestMessage(created.id, input);
    const second = await telegram.ingestMessage(created.id, input);
    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);

    await sources.remove(created.id, "tester");
    expect((await sources.list()).some((s) => s.id === created.id)).toBe(false);

    await prisma.sourceMessage.deleteMany({ where: { sourceId: created.id } });
    await prisma.source.delete({ where: { id: created.id } });
    await app.close();
  }, 30000);
});
