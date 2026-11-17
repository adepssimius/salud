CREATE TABLE "schedule_episodes" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"episode_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Hand-added: carry every existing schedule → episode link into the join table before the column
-- goes. Only links to an episode that exists and belongs to the schedule's own patient — the rule
-- the service now enforces (data-model.md → "Data integrity rules").
INSERT INTO "schedule_episodes" ("id", "schedule_id", "episode_id", "created_at")
SELECT gen_random_uuid()::text, s."id", s."episode_id", s."created_at"
FROM "intervention_schedules" s
JOIN "episodes" e ON e."id" = s."episode_id" AND e."patient_id" = s."patient_id";
--> statement-breakpoint
ALTER TABLE "intervention_schedules" DROP CONSTRAINT "intervention_schedules_episode_id_episodes_id_fk";
--> statement-breakpoint
ALTER TABLE "schedule_episodes" ADD CONSTRAINT "schedule_episodes_schedule_id_intervention_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."intervention_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_episodes" ADD CONSTRAINT "schedule_episodes_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intervention_schedules" DROP COLUMN "episode_id";