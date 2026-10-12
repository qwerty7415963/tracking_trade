import { IsIn, IsInt, IsObject, IsOptional, IsString, Min } from "class-validator";

export const SOURCE_PLATFORMS = ["TELEGRAM", "X"] as const;
export const SOURCE_KINDS = ["SIGNAL", "NEWS", "MIXED"] as const;

export class CreateSourceDto {
  @IsIn(SOURCE_PLATFORMS as unknown as string[])
  platform!: string;

  @IsString()
  externalSourceId!: string;

  @IsString()
  displayName!: string;

  @IsIn(SOURCE_KINDS as unknown as string[])
  sourceKind!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsObject()
  collectionConfig?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  parserProfileId?: string;
}

export class UpdateSourceDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsIn(SOURCE_KINDS as unknown as string[])
  sourceKind?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsObject()
  collectionConfig?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  parserProfileId?: string;
}
