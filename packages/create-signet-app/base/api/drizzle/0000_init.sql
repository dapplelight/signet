CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`table_name` text NOT NULL,
	`row_id` text,
	`before` text,
	`after` text
);
--> statement-breakpoint
CREATE TABLE `consents` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`purpose` text NOT NULL,
	`notice_version` text NOT NULL,
	`source` text,
	`given_at` integer NOT NULL,
	`withdrawn_at` integer
);
--> statement-breakpoint
CREATE INDEX `consents_subject` ON `consents` (`subject`,`purpose`);--> statement-breakpoint
CREATE TABLE `data_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_at` integer NOT NULL,
	`due_at` integer,
	`closed_at` integer,
	`closed_by` text,
	`note` text,
	`result` text
);
--> statement-breakpoint
CREATE INDEX `data_requests_subject` ON `data_requests` (`subject`);--> statement-breakpoint
CREATE TABLE `entitlement_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`value` integer,
	`expires_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `entitlement_overrides_subject` ON `entitlement_overrides` (`subject`);--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`rating` integer,
	`page` text,
	`meta` text,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`scope` text NOT NULL,
	`key` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `key`)
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`email` text,
	`invited_by` text NOT NULL,
	`scope` text,
	`role` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_by` text,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE TABLE `kv` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE TABLE `marks` (
	`subject` text NOT NULL,
	`key` text NOT NULL,
	`at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	PRIMARY KEY(`subject`, `key`)
);
--> statement-breakpoint
CREATE TABLE `referral_codes` (
	`subject` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referral_codes_code` ON `referral_codes` (`code`);--> statement-breakpoint
CREATE TABLE `referrals` (
	`referee` text PRIMARY KEY NOT NULL,
	`referrer` text NOT NULL,
	`code` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`converted_at` integer,
	`rewarded_at` integer
);
--> statement-breakpoint
CREATE INDEX `referrals_referrer` ON `referrals` (`referrer`);--> statement-breakpoint
CREATE TABLE `subject_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`plan` text NOT NULL,
	`status` text NOT NULL,
	`gateway` text NOT NULL,
	`subscription_id` text NOT NULL,
	`current_period_end` integer,
	`grace_until` integer,
	`event_at` integer NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `subject_plans_subject` ON `subject_plans` (`subject`);--> statement-breakpoint
CREATE TABLE `usage_counters` (
	`subject` text NOT NULL,
	`key` text NOT NULL,
	`period` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`subject`, `key`, `period`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`name` text,
	`email` text,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_phone_unique` ON `users` (`phone`);--> statement-breakpoint
CREATE TABLE `waitlist` (
	`email` text PRIMARY KEY NOT NULL,
	`source` text,
	`referral_code` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`invited_at` integer
);
