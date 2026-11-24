import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const preCanonicalCompanies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  careersUrl: text("careers_url").notNull(),
});
