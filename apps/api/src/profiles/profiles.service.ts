import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, ParserProfile } from "@prisma/client";
import { CoinProfile } from "@tracking-auto/domain";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { CreateProfileDto, UpdateProfileDto } from "./dto/profile.dto";

/** Uppercase both sides: { "paws": "btc" } -> { "PAWS": "BTC" }. */
export function normalizeAliases(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string") {
      throw new BadRequestException("coinAliases values must be strings");
    }
    const k = key.trim().toUpperCase();
    const v = value.trim().toUpperCase();
    if (!k || !v) throw new BadRequestException("coinAliases keys and values must not be empty");
    out[k] = v;
  }
  return out;
}

@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(): Promise<ParserProfile[]> {
    return this.prisma.parserProfile.findMany({ orderBy: { name: "asc" } });
  }

  async get(id: string): Promise<ParserProfile> {
    const profile = await this.prisma.parserProfile.findUnique({ where: { id } });
    if (!profile) throw new NotFoundException(`parser profile ${id} not found`);
    return profile;
  }

  /** Parser-ready aliases for a source profile id; null when unset/unknown. */
  async getProfile(id: string | null | undefined): Promise<CoinProfile | null> {
    if (!id) return null;
    const profile = await this.prisma.parserProfile.findUnique({ where: { id } });
    if (!profile || !profile.coinAliases) return null;
    return { coinAliases: profile.coinAliases as Record<string, string> };
  }

  async create(dto: CreateProfileDto, actor: string): Promise<ParserProfile> {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException("profile name must not be empty");
    try {
      const profile = await this.prisma.parserProfile.create({
        data: {
          name,
          coinAliases: dto.coinAliases ? normalizeAliases(dto.coinAliases) : undefined,
          notes: dto.notes,
          createdBy: actor,
        },
      });
      await this.audit.record(actor, "profile.create", { profileId: profile.id, name });
      return profile;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException(`parser profile "${name}" already exists`);
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateProfileDto, actor: string): Promise<ParserProfile> {
    await this.get(id);
    const name = dto.name === undefined ? undefined : dto.name.trim();
    if (name !== undefined && !name) {
      throw new BadRequestException("profile name must not be empty");
    }
    try {
      const profile = await this.prisma.parserProfile.update({
        where: { id },
        data: {
          name,
          coinAliases: dto.coinAliases ? normalizeAliases(dto.coinAliases) : undefined,
          notes: dto.notes,
          updatedBy: actor,
        },
      });
      await this.audit.record(actor, "profile.update", { profileId: id });
      return profile;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException(`parser profile "${name}" already exists`);
      }
      throw err;
    }
  }

  /** Hard delete: profiles carry no history FK. */
  async remove(id: string, actor: string): Promise<ParserProfile> {
    const profile = await this.get(id);
    await this.prisma.parserProfile.delete({ where: { id } });
    await this.audit.record(actor, "profile.delete", { profileId: id, name: profile.name });
    return profile;
  }
}
