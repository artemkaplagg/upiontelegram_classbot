import { pgTable, serial, bigint, text, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Groups table
export const groups = pgTable("groups", {
  id: serial("id").primaryKey(),
  groupName: text("group_name").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Students table
export const students = pgTable("students", {
  id: serial("id").primaryKey(),
  telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull().unique(),
  telegramUsername: text("telegram_username"),
  studentId: text("student_id").notNull().unique(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  groupId: integer("group_id").references(() => groups.id),
  accessLevel: text("access_level").default("student").$type<"student" | "admin" | "monitor" | "owner">(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Homework table
export const homework = pgTable("homework", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: timestamp("due_date"),
  subject: text("subject"),
  groupId: integer("group_id").references(() => groups.id),
  createdBy: integer("created_by").references(() => students.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// User sessions table
export const userSessions = pgTable("user_sessions", {
  id: serial("id").primaryKey(),
  telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
  sessionData: jsonb("session_data"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Define relations
export const groupsRelations = relations(groups, ({ many }) => ({
  students: many(students),
  homework: many(homework),
}));

export const studentsRelations = relations(students, ({ one, many }) => ({
  group: one(groups, {
    fields: [students.groupId],
    references: [groups.id],
  }),
  createdHomework: many(homework),
}));

export const homeworkRelations = relations(homework, ({ one }) => ({
  group: one(groups, {
    fields: [homework.groupId],
    references: [groups.id],
  }),
  creator: one(students, {
    fields: [homework.createdBy],
    references: [students.id],
  }),
}));