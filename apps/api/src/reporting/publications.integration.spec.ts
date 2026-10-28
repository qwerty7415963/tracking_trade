import { Test } from "@nestjs/testing";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AppModule } from "../app.module";
import { PrismaService } from "../database/prisma.service";
import { TELEGRAM_SENDER } from "./publications.service";
import { PublicationsService } from "./publications.service";
import { RendersService } from "./renders.service";

// Live-DB + filesystem artifact, fake Telegram sender.
// Runs only with INTEGRATION_TESTS=1 so plain `npm test` (and CI) stays hermetic.
const describeIntegration = process.env.INTEGRATION_TESTS ? describe : describe.skip;

describeIntegration("Publish flow (live DB, worker-written artifact, fake sender)", () => {
  it("sends a worker-rendered photo replying to the original", async () => {
    process.env.ARTIFACTS_DIR = join(tmpdir(), `it-artifacts-${Date.now()}`);
    const sentCalls: Array<Record<string, unknown>> = [];
    const fakeSender = {
      sendPhoto: jest.fn(async (input: Record<string, unknown>) => {
        sentCalls.push(input);
        return { ok: true, telegramMessageId: "999", unknown: false };
      }),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TELEGRAM_SENDER)
      .useValue(fakeSender)
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const publications = app.get(PublicationsService);
    const renders = app.get(RendersService);
    const prisma = app.get(PrismaService);

    const account = await prisma.virtualAccount.create({
      data: { name: "it-pub", balance: 10000, leverage: 10, mode: "APPROVE" },
    });
    const source = await prisma.source.create({
      data: {
        platform: "TELEGRAM",
        externalSourceId: `phase5-chan-${Date.now()}`,
        displayName: "Osho",
        sourceKind: "SIGNAL",
      },
    });
    const message = await prisma.sourceMessage.create({
      data: {
        sourceId: source.id,
        externalMessageId: "p5m1",
        contentRaw: "Short ETH limit Entry 2583.79 SL 2597.17 TP 2499",
        sourceUrl: "https://t.me/traderosho/4375",
        contentHash: "h5",
      },
    });
    const signal = await prisma.signal.create({
      data: { sourceId: source.id, instrument: "ETH", direction: "SHORT", status: "APPROVED" },
    });
    const version = await prisma.signalVersion.create({
      data: {
        signalId: signal.id,
        versionNumber: 1,
        eventType: "NEW",
        instrument: "ETH",
        direction: "SHORT",
        entry: 2583.79,
        stopLoss: 2597.17,
        takeProfits: [2499],
        normalizedPayloadJson: { source_message_id: "p5m1" },
      },
    });
    await prisma.approval.create({
      data: { signalId: signal.id, signalVersionId: version.id, decision: "APPROVED", approvedBy: "alice" },
    });
    const position = await prisma.virtualPosition.create({
      data: {
        accountId: account.id,
        signalId: signal.id,
        signalVersionId: version.id,
        coin: "ETH",
        direction: "SHORT",
        size: 0.05,
        entryPrice: 2583.79,
        stopLoss: 2597.17,
        takeProfits: [2499],
        leverage: 10,
        remainingSize: 0.05,
        filledTps: [],
        status: "OPEN",
      },
    });
    const publication = await prisma.telegramPublication.create({
      data: { virtualPositionId: position.id, publicationStatus: "PENDING" },
    });

    const artifactPath = await renders.writeArtifact(
      publication.id,
      Buffer.alloc(1500, 1),
    );
    const result = (await publications.sendPublication(publication.id, {
      publicationId: publication.id,
      positionId: position.id,
      status: "filled",
      markPrice: 2580,
      destinationChatId: "@testchan",
      replyToMessageId: "111",
      artifactPath,
      actor: "alice",
    })) as { publicationStatus: string; telegramMessageId: string; renderedText: string };

    expect(result.publicationStatus).toBe("PUBLISHED");
    expect(result.telegramMessageId).toBe("999");
    expect(result.renderedText).toContain("Osho");
    expect(result.renderedText).toContain("https://t.me/traderosho/4375");
    expect(sentCalls).toHaveLength(1);
    expect(sentCalls[0].replyToMessageId).toBe("111");
    expect(Buffer.isBuffer(sentCalls[0].photo)).toBe(true);

    const stat = await fs.stat(artifactPath);
    expect(stat.size).toBeGreaterThan(1000);

    // Cleanup.
    await fs.unlink(artifactPath);
    await prisma.telegramPublication.delete({ where: { id: publication.id } });
    await prisma.virtualPosition.delete({ where: { id: position.id } });
    await prisma.approval.deleteMany({ where: { signalId: signal.id } });
    await prisma.signalVersion.delete({ where: { id: version.id } });
    await prisma.signal.delete({ where: { id: signal.id } });
    await prisma.sourceMessage.delete({ where: { id: message.id } });
    await prisma.source.delete({ where: { id: source.id } });
    await prisma.virtualTransaction.deleteMany({ where: { accountId: account.id } });
    await prisma.virtualAccount.delete({ where: { id: account.id } });
    await app.close();
  }, 90000);
});
