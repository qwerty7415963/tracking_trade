-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "external_source_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "source_kind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "collection_config_json" JSONB,
    "parser_profile_id" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "last_error_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_credentials" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "credential_name" TEXT NOT NULL,
    "encrypted_secret_ref" TEXT NOT NULL,
    "account_label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "last_validated_at" TIMESTAMP(3),

    CONSTRAINT "connector_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_credential_bindings" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,

    CONSTRAINT "source_credential_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_messages" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "external_message_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "content_raw" TEXT NOT NULL,
    "author_id" TEXT,
    "author_name" TEXT,
    "source_url" TEXT,
    "thread_id" TEXT,
    "reply_to_message_id" TEXT,
    "quoted_message_id" TEXT,
    "source_timestamp" TIMESTAMP(3),
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "content_hash" TEXT NOT NULL,

    CONSTRAINT "source_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signals" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "instrument" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DETECTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signal_versions" (
    "id" TEXT NOT NULL,
    "signal_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "instrument" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "order_type" TEXT,
    "entry" DECIMAL(30,8),
    "stop_loss" DECIMAL(30,8),
    "take_profits" JSONB,
    "normalized_payload_json" JSONB,
    "parser_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signal_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signal_updates" (
    "id" TEXT NOT NULL,
    "source_message_id" TEXT NOT NULL,
    "matched_signal_id" TEXT,
    "match_confidence" DECIMAL(5,4),
    "validation_status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "action_type" TEXT,
    "action_payload_json" JSONB,
    "review_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signal_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" TEXT NOT NULL,
    "signal_id" TEXT NOT NULL,
    "signal_version_id" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "approved_by" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_commands" (
    "id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "signal_id" TEXT,
    "signal_version_id" TEXT,
    "command_type" TEXT NOT NULL,
    "payload_json" JSONB,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "execution_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "executions" (
    "id" TEXT NOT NULL,
    "execution_command_id" TEXT NOT NULL,
    "broker_order_id" TEXT,
    "broker_deal_id" TEXT,
    "broker_position_id" TEXT,
    "requested_volume" DECIMAL(30,8),
    "filled_volume" DECIMAL(30,8),
    "fill_price" DECIMAL(30,8),
    "actual_sl" DECIMAL(30,8),
    "actual_tp" DECIMAL(30,8),
    "execution_status" TEXT NOT NULL DEFAULT 'PENDING',
    "opened_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_events" (
    "id" TEXT NOT NULL,
    "command_id" TEXT,
    "check_name" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "reason" TEXT,
    "config_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_sender_accounts" (
    "id" TEXT NOT NULL,
    "account_type" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "credential_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "last_validated_at" TIMESTAMP(3),
    "last_error" TEXT,

    CONSTRAINT "telegram_sender_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_destinations" (
    "id" TEXT NOT NULL,
    "sender_account_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "channel_name" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "telegram_destinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "template_body" TEXT NOT NULL,
    "template_version" INTEGER NOT NULL DEFAULT 1,
    "required_fields_json" JSONB,
    "parse_mode" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "reporting_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting_routes" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "destination_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "reporting_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_publications" (
    "id" TEXT NOT NULL,
    "execution_id" TEXT,
    "sender_account_id" TEXT,
    "destination_id" TEXT,
    "template_id" TEXT,
    "template_version" INTEGER,
    "source_message_id" TEXT,
    "source_platform" TEXT,
    "source_url" TEXT,
    "source_display_name" TEXT,
    "source_telegram_name" TEXT,
    "destination_channel_name" TEXT,
    "rendered_text" TEXT,
    "telegram_message_id" TEXT,
    "publication_status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "telegram_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entity_id" TEXT,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_heartbeats" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "terminal" TEXT,
    "status" TEXT NOT NULL,
    "details" JSONB,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bridge_heartbeats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sources_platform_external_source_id_key" ON "sources"("platform", "external_source_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_credential_bindings_source_id_credential_id_purpose_key" ON "source_credential_bindings"("source_id", "credential_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "source_messages_source_id_external_message_id_revision_key" ON "source_messages"("source_id", "external_message_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "signal_versions_signal_id_version_number_key" ON "signal_versions"("signal_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "execution_commands_idempotency_key_key" ON "execution_commands"("idempotency_key");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_idx" ON "audit_logs"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "bridge_heartbeats_account_id_received_at_idx" ON "bridge_heartbeats"("account_id", "received_at");

-- CreateIndex
CREATE INDEX "outbox_events_status_created_at_idx" ON "outbox_events"("status", "created_at");

-- AddForeignKey
ALTER TABLE "source_credential_bindings" ADD CONSTRAINT "source_credential_bindings_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "connector_credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_messages" ADD CONSTRAINT "source_messages_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signals" ADD CONSTRAINT "signals_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signal_versions" ADD CONSTRAINT "signal_versions_signal_id_fkey" FOREIGN KEY ("signal_id") REFERENCES "signals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signal_updates" ADD CONSTRAINT "signal_updates_source_message_id_fkey" FOREIGN KEY ("source_message_id") REFERENCES "source_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signal_updates" ADD CONSTRAINT "signal_updates_matched_signal_id_fkey" FOREIGN KEY ("matched_signal_id") REFERENCES "signals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_signal_id_fkey" FOREIGN KEY ("signal_id") REFERENCES "signals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_signal_version_id_fkey" FOREIGN KEY ("signal_version_id") REFERENCES "signal_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_commands" ADD CONSTRAINT "execution_commands_signal_version_id_fkey" FOREIGN KEY ("signal_version_id") REFERENCES "signal_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executions" ADD CONSTRAINT "executions_execution_command_id_fkey" FOREIGN KEY ("execution_command_id") REFERENCES "execution_commands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_destinations" ADD CONSTRAINT "telegram_destinations_sender_account_id_fkey" FOREIGN KEY ("sender_account_id") REFERENCES "telegram_sender_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reporting_routes" ADD CONSTRAINT "reporting_routes_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "telegram_destinations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reporting_routes" ADD CONSTRAINT "reporting_routes_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "reporting_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_publications" ADD CONSTRAINT "telegram_publications_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_publications" ADD CONSTRAINT "telegram_publications_sender_account_id_fkey" FOREIGN KEY ("sender_account_id") REFERENCES "telegram_sender_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_publications" ADD CONSTRAINT "telegram_publications_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "telegram_destinations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_publications" ADD CONSTRAINT "telegram_publications_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "reporting_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
