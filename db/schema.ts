import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

// One row per pilot user: anonymous usage counters and feedback only.
// Never store transcripts, SOAP content or patient identifiers here.
export const usage = pgTable("usage", {
  userId: text("user_id").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
