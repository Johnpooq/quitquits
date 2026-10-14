CREATE TABLE "chat_message" (
	"device_id" text NOT NULL,
	"id" text NOT NULL,
	"position" integer NOT NULL,
	"conversation_id" text NOT NULL,
	"daily_entry_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"candidate_event_ids" jsonb,
	"suggestion_ids" jsonb,
	"emergency" boolean,
	"update_suggestion_event_id" text,
	"clarify" jsonb,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "chat_message_device_id_id_pk" PRIMARY KEY("device_id","id")
);
--> statement-breakpoint
CREATE TABLE "daily_entry" (
	"device_id" text NOT NULL,
	"id" text NOT NULL,
	"position" integer NOT NULL,
	"date" date NOT NULL,
	"mood" text,
	"content" text DEFAULT '' NOT NULL,
	"draft_text" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conversation_id" text NOT NULL,
	"event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggestion_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_summary" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "daily_entry_device_id_id_pk" PRIMARY KEY("device_id","id")
);
--> statement-breakpoint
CREATE TABLE "device" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "emergency_session" (
	"device_id" text NOT NULL,
	"id" text NOT NULL,
	"position" integer NOT NULL,
	"category" text NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"facts_draft" text DEFAULT '' NOT NULL,
	"priority" text NOT NULL,
	"priority_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"event_id" text,
	"date" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "emergency_session_device_id_id_pk" PRIMARY KEY("device_id","id")
);
--> statement-breakpoint
CREATE TABLE "event" (
	"device_id" text NOT NULL,
	"id" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"occurred_at" text NOT NULL,
	"people" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"attention" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"material_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "event_device_id_id_pk" PRIMARY KEY("device_id","id")
);
--> statement-breakpoint
CREATE TABLE "material" (
	"device_id" text NOT NULL,
	"id" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"coverage_start" text,
	"coverage_end" text,
	"is_current" boolean NOT NULL,
	"event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"file_id" text,
	"file_name" text,
	"mime_type" text,
	"file_size" integer,
	"external_location_note" text,
	"extraction_draft" text,
	"confirmed_extraction" text,
	"extraction_status" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "material_device_id_id_pk" PRIMARY KEY("device_id","id")
);
--> statement-breakpoint
CREATE TABLE "material_suggestion" (
	"device_id" text NOT NULL,
	"id" text NOT NULL,
	"position" integer NOT NULL,
	"event_id" text,
	"entry_id" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"coverage_start" text,
	"coverage_end" text,
	"status" text NOT NULL,
	"priority" boolean,
	"resolved_material_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "material_suggestion_device_id_id_pk" PRIMARY KEY("device_id","id")
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"device_id" text PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"employment_status" text NOT NULL,
	"company" text,
	"role" text,
	"start_date" text,
	"city" text
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"device_id" text PRIMARY KEY NOT NULL,
	"onboarded" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"notification_enabled" boolean DEFAULT false NOT NULL,
	"mock_delay_ms" integer DEFAULT 650 NOT NULL,
	"mock_fail_next" boolean DEFAULT false NOT NULL,
	"data_version" integer DEFAULT 3 NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stored_file" (
	"device_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stored_file_device_id_id_pk" PRIMARY KEY("device_id","id")
);
--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_entry" ADD CONSTRAINT "daily_entry_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_session" ADD CONSTRAINT "emergency_session_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material" ADD CONSTRAINT "material_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_suggestion" ADD CONSTRAINT "material_suggestion_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_file" ADD CONSTRAINT "stored_file_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_message_entry_idx" ON "chat_message" USING btree ("device_id","daily_entry_id");--> statement-breakpoint
CREATE INDEX "daily_entry_date_idx" ON "daily_entry" USING btree ("device_id","date");