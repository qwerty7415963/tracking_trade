import { Module } from "@nestjs/common";
import { SignalsModule } from "../signals/signals.module";
import { SourcesModule } from "../sources/sources.module";
import { IngestionService } from "./ingestion.service";

@Module({
  imports: [SourcesModule, SignalsModule],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class IngestionModule {}
