import { IsBoolean, IsNumber, IsOptional, IsPositive, IsString } from "class-validator";

export class CreateCoinDto {
  @IsString()
  symbol!: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  notionalUsd?: number;

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
  @IsNumber()
  @IsPositive()
  notionalUsd?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
