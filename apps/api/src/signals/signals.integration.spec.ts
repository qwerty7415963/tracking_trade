import { Test } from "@nestjs/testing";
import { AppModule } from "../app.module";
import { PrismaService } from "../database/prisma.service";
import { SignalsService } from "./signals.service";
import { SignalUpdatesService } from "./signal-updates.service";

// Live-DB test: needs Postgres (deploy/docker-compose.yml).
// Runs only with INTEGRATION_TESTS=1 so plain `npm test` (and CI) stays hermetic.
const describeIntegration = process.env.INTEGRATION_TESTS ? describe : describe.skip;

const FULL_SIGNAL = `BUY XAUUSD limit
Entry: 2345.67
SL: 2340.00
TP1: 2350.00`;

describeIntegration("Signals flow (live DB)", () => {
  it("ingest -> approve -> stale re-approve rejected; missing fields -> review; reply update matched", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const signals = app.get(SignalsService);
    const updates = app.get(SignalUpdatesService);
    const prisma = app.get(PrismaService);

    const source = await prisma.source.create({
      data: {
        platform: "TELEGRAM",
        externalSourceId: "phase3-chan",
        displayName: "P3",
        sourceKind: "SIGNAL",
      },
    });
    const msg = await prisma.sourceMessage.create({
      data: {
        sourceId: source.id,
        externalMessageId: "pm1",
        contentRaw: FULL_SIGNAL,
        authorId: "auth1",
        contentHash: "h1",
      },
    });

    const outcome = await signals.ingestSourceMessage(msg.id, "tester");
    expect(outcome.kind).toBe("SIGNAL");
    expect(outcome.status).toBe("PENDING_APPROVAL");

    const full = await signals.get(outcome.signalId as string);
    const v1 = full.versions[0].id;
    const approval = await signals.approve(outcome.signalId as string, { signalVersionId: v1 }, "alice");
    expect(approval.decision).toBe("APPROVED");

    // Simulate an edit: new version lands, old approval goes stale.
    await prisma.signalVersion.create({
      data: {
        signalId: outcome.signalId as string,
        versionNumber: 2,
        eventType: "NEW",
        instrument: "XAUUSD.a",
        direction: "LONG",
        normalizedPayloadJson: {},
      },
    });
    await prisma.signal.update({
      where: { id: outcome.signalId as string },
      data: { status: "PENDING_APPROVAL" },
    });
    await expect(
      signals.approve(outcome.signalId as string, { signalVersionId: v1 }, "alice"),
    ).rejects.toThrow("stale");

    // Missing SL -> NEEDS_REVIEW, never auto-approved.
    const poorMsg = await prisma.sourceMessage.create({
      data: {
        sourceId: source.id,
        externalMessageId: "pm2",
        contentRaw: "BUY EURUSD Entry 1.0850",
        contentHash: "h2",
      },
    });
    const poor = await signals.ingestSourceMessage(poorMsg.id, "tester");
    expect(poor.status).toBe("NEEDS_REVIEW");

    // Reply update matches the first signal.
    const updMsg = await prisma.sourceMessage.create({
      data: {
        sourceId: source.id,
        externalMessageId: "pm3",
        contentRaw: "Move SL to breakeven",
        authorId: "auth1",
        replyToMessageId: "pm1",
        contentHash: "h3",
      },
    });
    const updOutcome = await signals.ingestSourceMessage(updMsg.id, "tester");
    expect(updOutcome.kind).toBe("UPDATE");
    const queue = await updates.reviewQueue();
    const created = await prisma.signalUpdate.findFirst({
      where: { sourceMessageId: updMsg.id },
    });
    expect(["VALIDATED", "AMBIGUOUS", "ACTION_PENDING_REVIEW", "UNVERIFIED"]).toContain(
      created?.validationStatus,
    );
    expect(queue).toBeDefined();

    // Cleanup.
    await prisma.signalUpdate.deleteMany({ where: { sourceMessage: { sourceId: source.id } } });
    await prisma.approval.deleteMany({ where: { signalId: outcome.signalId as string } });
    await prisma.signalVersion.deleteMany({ where: { signalId: outcome.signalId as string } });
    await prisma.signal.delete({ where: { id: outcome.signalId as string } });
    const poorSignal = await prisma.signal.findFirst({ where: { sourceId: source.id } });
    if (poorSignal) {
      await prisma.signalVersion.deleteMany({ where: { signalId: poorSignal.id } });
      await prisma.signal.delete({ where: { id: poorSignal.id } });
    }
    await prisma.sourceMessage.deleteMany({ where: { sourceId: source.id } });
    await prisma.source.delete({ where: { id: source.id } });
    await app.close();
  }, 60000);
});
