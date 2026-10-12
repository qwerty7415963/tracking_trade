import { IsOptional, IsString } from "class-validator";

export class ApproveSignalDto {
  @IsString()
  signalVersionId!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class RejectSignalDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ApproveUpdateDto {
  @IsOptional()
  @IsString()
  signalId?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
