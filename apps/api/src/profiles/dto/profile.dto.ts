import { IsObject, IsOptional, IsString } from "class-validator";

export class CreateProfileDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsObject()
  coinAliases?: Record<string, string>;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsObject()
  coinAliases?: Record<string, string>;

  @IsOptional()
  @IsString()
  notes?: string;
}
