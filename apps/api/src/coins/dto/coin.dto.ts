import { IsBoolean, IsOptional, IsString } from "class-validator";

export class CreateCoinDto {
  @IsString()
  symbol!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateCoinDto {
  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}
