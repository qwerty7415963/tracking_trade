import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { ApproveUpdateDto, RejectSignalDto } from "./dto/signal.dto";

const REVIEW_STATUSES = ["AMBIGUOUS", "UNVERIFIED", "ACTION_PENDING_REVIEW"];

@Injectable()
export class SignalUpdatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  reviewQueue() {
    return this.prisma.signalUpdate.findMany({
      where: { validationStatus: { in: REVIEW_STATUSES } },
      orderBy: { createdAt: "asc" },
      include: { sourceMessage: true },
    });
  }

  async approve(id: string, dto: ApproveUpdateDto, actor: string) {
    const update = await this.prisma.signalUpdate.findUnique({ where: { id } });
    if (!update) throw new NotFoundException(`update ${id} not found`);
    if (!REVIEW_STATUSES.includes(update.validationStatus)) {
      throw new ConflictException(`update ${id} is ${update.validationStatus}, not reviewable`);
    }
    let matchedSignalId = update.matchedSignalId;
    if (update.validationStatus === "AMBIGUOUS") {
      if (!dto.signalId) throw new BadRequestException("ambiguous update requires signalId");
      const target = await this.prisma.signal.findUnique({ where: { id: dto.signalId } });
      if (!target) throw new NotFoundException(`signal ${dto.signalId} not found`);
      matchedSignalId = dto.signalId;
    }
    const updated = await this.prisma.signalUpdate.update({
      where: { id },
      data: { matchedSignalId, validationStatus: "VALIDATED" },
    });
    await this.audit.record(actor, "signal.update.approve", { updateId: id });
    return updated;
  }

  async reject(id: string, dto: RejectSignalDto, actor: string) {
    const update = await this.prisma.signalUpdate.findUnique({ where: { id } });
    if (!update) throw new NotFoundException(`update ${id} not found`);
    if (!REVIEW_STATUSES.includes(update.validationStatus)) {
      throw new ConflictException(`update ${id} is ${update.validationStatus}, not reviewable`);
    }
    const updated = await this.prisma.signalUpdate.update({
      where: { id },
      data: { validationStatus: "REJECTED", reviewReason: dto.reason },
    });
    await this.audit.record(actor, "signal.update.reject", { updateId: id });
    return updated;
  }
}
