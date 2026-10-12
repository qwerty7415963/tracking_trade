import { Test } from "@nestjs/testing";
import { promises as fs } from "fs";
import { AppModule } from "../app.module";
import { PrismaService } from "../database/prisma.service";
import { BRIDGE_PORT, BridgePort } from "../bridge/mt5-bridge.adapter";
import { CARD_RENDERER, TELEGRAM_SENDER } from "./publications.service";
import { PublicationsService } from "./publications.service";
import { createDefaultRenderer } from "./publications.service";

// Live-DB + real browser render, fake bridge + fake Telegram sender.
// Runs only with INTEGRATION_TESTS=1 so plain `npm test` (and CI) stays hermetic.
const describeIntegration = process.env.INTEGRATION_TESTS ? describe : describe.skip;

describeIntegration("Publish flow (live DB, fake bridge/sender, real render)", () => {
  it("renders card, saves artifact, sends photo replying to the original", async () => {
    const sentCalls: Array<Record<string, unknown>> = [];
    const fakeBridge = {
      positions: jest.fn(async () => [
        {
          positionId: "pPub",
          orderId: "o1",
          symbol: "XAUUSD.a",
          direction: "LONG",
          volume: 0.05,
          openPrice: 2345,
          stopLoss: 2340,
          takeProfit: 2360,
          profit: 12.5,
          currentPrice: 2347.5,
        },
      ]),
    } as unknown as BridgePort;
    const fakeSender = {
      sendPhoto: jest.fn(async (input: Record<string, unknown>) => {
        sentCalls.push(input);
        return { ok: true, telegramMessageId: "999", unknown: false };
      }),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BRIDGE_PORT)
      .useValue(fakeBridge)
      .overrideProvider(TELEGRAM_SENDER)
      .useValue(fakeSender)
      .overrideProvider(CARD_RENDERER)
      .useValue(createDefaultRenderer())
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const publications = app.get(PublicationsService);
    const prisma = app.get(PrismaService);

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
      data: { sourceId: source.id, instrument: "ETHUSD.a", direction: "SHORT", status: "APPROVED" },
    });
    const version = await prisma.signalVersion.create({
      data: {
        signalId: signal.id,
        versionNumber: 1,
        eventType: "NEW",
        instrument: "ETHUSD.a",
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
    const command = await prisma.executionCommand.create({
      data: {
        idempotencyKey: `pub-it-${Date.now()}`,
        accountId: "acc1",
        signalId: signal.id,
        signalVersionId: version.id,
        commandType: "OPEN",
        payloadJson: { symbol: "XAUUSD.a", volume: 0.05 },
        status: "CONFIRMED",
      },
    });
    const execution = await prisma.execution.create({
      data: {
        executionCommandId: command.id,
        brokerPositionId: "pPub",
        requestedVolume: 0.05,
        filledVolume: 0.05,
        fillPrice: 2345,
        actualSl: 2340,
        actualTp: 2360,
        executionStatus: "OPEN",
      },
    });
    const publication = await prisma.telegramPublication.create({
      data: { executionId: execution.id, publicationStatus: "PENDING" },
    });

    const result = (await publications.publishNow(
      publication.id,
      { executionId: execution.id, destinationChatId: "@testchan", replyToMessageId: "111" },
      "alice",
    )) as { publicationStatus: string; telegramMessageId: string; renderedText: string };

    expect(result.publicationStatus).toBe("PUBLISHED");
    expect(result.telegramMessageId).toBe("999");
    expect(result.renderedText).toContain("Osho");
    expect(result.renderedText).toContain("https://t.me/traderosho/4375");
    expect(sentCalls).toHaveLength(1);
    expect(sentCalls[0].replyToMessageId).toBe("111");
    expect(Buffer.isBuffer(sentCalls[0].photo)).toBe(true);

    const artifact = await prisma.renderArtifact.findFirst({
      where: { positionId: "pPub" },
    });
    expect(artifact).toBeTruthy();
    const stat = await fs.stat(artifact!.artifactPath);
    expect(stat.size).toBeGreaterThan(1000);

    // Cleanup.
    await prisma.telegramPublication.delete({ where: { id: publication.id } });
    await prisma.renderArtifact.deleteMany({ where: { positionId: "pPub" } });
    await prisma.execution.delete({ where: { id: execution.id } });
    await prisma.executionCommand.delete({ where: { id: command.id } });
    await prisma.approval.deleteMany({ where: { signalId: signal.id } });
    await prisma.signalVersion.delete({ where: { id: version.id } });
    await prisma.signal.delete({ where: { id: signal.id } });
    await prisma.sourceMessage.delete({ where: { id: message.id } });
    await prisma.source.delete({ where: { id: source.id } });
    await app.close();
  }, 90000);
});
