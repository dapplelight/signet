CREATE TABLE `offerings` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`version` integer NOT NULL,
	`products` text NOT NULL,
	`paywall` text,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `placements` (
	`placement` text PRIMARY KEY NOT NULL,
	`offering` text NOT NULL,
	`version` integer,
	`overrides` text NOT NULL,
	`experiment` text,
	`updated_by` text,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_spend_caps` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`subject` text NOT NULL,
	`period` text NOT NULL,
	`units` integer,
	`updated_by` text,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_events` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`run_id` text,
	`payload` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workflow_events_name` ON `workflow_events` (`name`,`id`);--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow` text NOT NULL,
	`input` text,
	`status` text NOT NULL,
	`output` text,
	`error` text,
	`created_by` text,
	`wake_at` integer,
	`lease_owner` text,
	`lease_until` integer,
	`waiting_on` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `workflow_runs_due` ON `workflow_runs` (`status`,`wake_at`);--> statement-breakpoint
CREATE TABLE `workflow_steps` (
	`run_id` text NOT NULL,
	`step_id` text NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`output` text,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`wake_at` integer,
	`event` text,
	`event_id` text,
	`approvers` text,
	`summary` text,
	`decided_by` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	PRIMARY KEY(`run_id`, `step_id`)
);
