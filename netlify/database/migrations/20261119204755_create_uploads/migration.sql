CREATE TABLE "uploads" (
	"id" serial PRIMARY KEY,
	"title" text NOT NULL,
	"artist" text DEFAULT 'Unknown artist' NOT NULL,
	"blob_key" text NOT NULL UNIQUE,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
