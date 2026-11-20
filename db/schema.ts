import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const uploads = pgTable("uploads", {
  id: serial().primaryKey(),
  title: text().notNull(),
  artist: text().notNull().default("Unknown artist"),
  blobKey: text("blob_key").notNull().unique(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
