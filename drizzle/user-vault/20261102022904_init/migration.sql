CREATE TABLE `files` (
	`folder_id` text NOT NULL,
	`file_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	CONSTRAINT `files_pk` PRIMARY KEY(`folder_id`, `file_id`)
);
--> statement-breakpoint
CREATE TABLE `folders` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`position` integer NOT NULL
);
