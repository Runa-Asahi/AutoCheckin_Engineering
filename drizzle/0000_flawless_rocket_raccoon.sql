CREATE TABLE `credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`cred_type` text NOT NULL,
	`cred_key` text NOT NULL,
	`cred_value_enc` blob NOT NULL,
	`cred_iv` blob NOT NULL,
	`expires_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_creds_task` ON `credentials` (`task_id`,`cred_type`);--> statement-breakpoint
CREATE TABLE `execution_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`run_id` text NOT NULL,
	`status` text NOT NULL,
	`engine_used` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`request_summary` text,
	`response_summary` text,
	`error_message` text,
	`screenshot_path` text,
	`retry_count` integer DEFAULT 0,
	`executed_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_logs_task_time` ON `execution_logs` (`task_id`,`executed_at`);--> statement-breakpoint
CREATE INDEX `idx_logs_run_id` ON `execution_logs` (`run_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`is_encrypted` integer DEFAULT 0,
	`category` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `site_cookies` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`domain` text NOT NULL,
	`path` text DEFAULT '/',
	`name` text NOT NULL,
	`value_enc` blob NOT NULL,
	`value_iv` blob NOT NULL,
	`expires_at` text,
	`secure` integer DEFAULT 0,
	`httponly` integer DEFAULT 0,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_cookies_task_domain` ON `site_cookies` (`task_id`,`domain`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`site_name` text NOT NULL,
	`engine_type` text NOT NULL,
	`login_type` text NOT NULL,
	`schedule` text DEFAULT '0 8 * * *',
	`enabled` integer DEFAULT 1,
	`priority` integer DEFAULT 0,
	`config_json` text NOT NULL,
	`adapter_id` text NOT NULL,
	`account_label` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_run_at` text,
	`last_status` text,
	`consecutive_days` integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_status` ON `tasks` (`last_status`);--> statement-breakpoint
CREATE INDEX `idx_tasks_enabled` ON `tasks` (`enabled`,`priority`);--> statement-breakpoint
CREATE INDEX `idx_tasks_site_account` ON `tasks` (`site_id`,`account_label`);