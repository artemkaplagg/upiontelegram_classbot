import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { students, groups, homework } from "../../../shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";

// Tool for adding new homework
export const addHomeworkTool = createTool({
  id: "add-homework-tool",
  description: "Add new homework assignment (only for monitors, admins, and owners)",
  inputSchema: z.object({
    createdByTelegramId: z.number().describe("Telegram ID of the person creating homework"),
    title: z.string().describe("Homework title"),
    description: z.string().optional().describe("Homework description"),
    subject: z.string().optional().describe("Subject name"),
    dueDate: z.string().optional().describe("Due date in format YYYY-MM-DD HH:MM"),
    groupId: z.number().optional().describe("Specific group ID (if not provided, will use creator's group)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    homework: z.object({
      id: z.number(),
      title: z.string(),
      description: z.string().nullable(),
      subject: z.string().nullable(),
      dueDate: z.string().nullable(),
      groupName: z.string(),
    }).nullable(),
    message: z.string(),
  }),
  execute: async ({ context: { createdByTelegramId, title, description, subject, dueDate, groupId }, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [AddHomeworkTool] Starting homework creation with params:', {
      createdByTelegramId, title, subject, groupId
    });

    try {
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) {
        logger?.error('❌ [AddHomeworkTool] Database connection string not found');
        return { success: false, homework: null, message: "Ошибка подключения к базе данных" };
      }

      const client = postgres(connectionString);
      const db = drizzle(client);

      // Verify user has permission to add homework
      const creator = await db
        .select({
          id: students.id,
          accessLevel: students.accessLevel,
          groupId: students.groupId,
          firstName: students.firstName,
        })
        .from(students)
        .where(eq(students.telegramUserId, createdByTelegramId))
        .limit(1);

      if (creator.length === 0) {
        await client.end();
        logger?.info('❌ [AddHomeworkTool] Creator not found in database');
        return { success: false, homework: null, message: "Пользователь не найден в базе данных" };
      }

      const creatorData = creator[0];
      const hasPermission = ['monitor', 'admin', 'owner'].includes(creatorData.accessLevel || 'student');

      if (!hasPermission) {
        await client.end();
        logger?.info('❌ [AddHomeworkTool] User lacks permission:', creatorData.accessLevel);
        return { 
          success: false, 
          homework: null, 
          message: "У вас нет прав для добавления домашних заданий. Обратитесь к старосте или администратору."
        };
      }

      // Determine target group
      const targetGroupId = groupId || creatorData.groupId;
      if (!targetGroupId) {
        await client.end();
        logger?.info('❌ [AddHomeworkTool] No group specified and creator has no group');
        return { success: false, homework: null, message: "Не удалось определить группу для домашнего задания" };
      }

      // Get group name
      const groupResult = await db
        .select({ groupName: groups.groupName })
        .from(groups)
        .where(eq(groups.id, targetGroupId))
        .limit(1);

      if (groupResult.length === 0) {
        await client.end();
        logger?.info('❌ [AddHomeworkTool] Group not found:', targetGroupId);
        return { success: false, homework: null, message: "Группа не найдена" };
      }

      // Parse due date
      let parsedDueDate: Date | null = null;
      if (dueDate) {
        try {
          parsedDueDate = new Date(dueDate);
          if (isNaN(parsedDueDate.getTime())) {
            parsedDueDate = null;
          }
        } catch (error) {
          logger?.warn('⚠️ [AddHomeworkTool] Invalid due date format:', dueDate);
        }
      }

      // Create homework
      const newHomework = await db
        .insert(homework)
        .values({
          title,
          description: description || null,
          subject: subject || null,
          dueDate: parsedDueDate,
          groupId: targetGroupId,
          createdBy: creatorData.id,
        })
        .returning();

      await client.end();

      const created = newHomework[0];
      logger?.info('✅ [AddHomeworkTool] Homework created successfully:', created.id);

      return {
        success: true,
        homework: {
          id: created.id,
          title: created.title,
          description: created.description,
          subject: created.subject,
          dueDate: created.dueDate?.toISOString() || null,
          groupName: groupResult[0].groupName,
        },
        message: `Домашнее задание "${title}" успешно добавлено для группы "${groupResult[0].groupName}".`
      };

    } catch (error) {
      logger?.error('❌ [AddHomeworkTool] Error creating homework:', error);
      return { success: false, homework: null, message: "Произошла ошибка при создании домашнего задания" };
    }
  },
});

// Tool for viewing homework
export const viewHomeworkTool = createTool({
  id: "view-homework-tool", 
  description: "View homework assignments for student's group or all groups (for admins)",
  inputSchema: z.object({
    telegramUserId: z.number().describe("Telegram ID of the person viewing homework"),
    groupId: z.number().optional().describe("Specific group ID (for admins only)"),
    limit: z.number().default(10).describe("Number of homework items to return (default 10)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    homeworkList: z.array(z.object({
      id: z.number(),
      title: z.string(),
      description: z.string().nullable(),
      subject: z.string().nullable(),
      dueDate: z.string().nullable(),
      groupName: z.string(),
      creatorName: z.string().nullable(),
      createdAt: z.string(),
    })),
    message: z.string(),
  }),
  execute: async ({ context: { telegramUserId, groupId, limit }, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [ViewHomeworkTool] Starting homework view with params:', {
      telegramUserId, groupId, limit
    });

    try {
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) {
        logger?.error('❌ [ViewHomeworkTool] Database connection string not found');
        return { success: false, homeworkList: [], message: "Ошибка подключения к базе данных" };
      }

      const client = postgres(connectionString);
      const db = drizzle(client);

      // Get user information
      const user = await db
        .select({
          id: students.id,
          accessLevel: students.accessLevel,
          groupId: students.groupId,
          firstName: students.firstName,
        })
        .from(students)
        .where(eq(students.telegramUserId, telegramUserId))
        .limit(1);

      if (user.length === 0) {
        await client.end();
        logger?.info('❌ [ViewHomeworkTool] User not found in database');
        return { success: false, homeworkList: [], message: "Пользователь не найден в базе данных" };
      }

      const userData = user[0];
      const isAdmin = ['admin', 'owner'].includes(userData.accessLevel || 'student');

      // Determine which group(s) to show homework for
      let targetGroupId = groupId;
      if (!isAdmin || !groupId) {
        targetGroupId = userData.groupId || undefined;
      }

      if (!targetGroupId) {
        await client.end();
        logger?.info('❌ [ViewHomeworkTool] No group to show homework for');
        return { success: false, homeworkList: [], message: "Группа не определена" };
      }

      // Fetch homework
      const homeworkResults = await db
        .select({
          id: homework.id,
          title: homework.title,
          description: homework.description,
          subject: homework.subject,
          dueDate: homework.dueDate,
          createdAt: homework.createdAt,
          groupName: groups.groupName,
          creatorFirstName: students.firstName,
          creatorLastName: students.lastName,
        })
        .from(homework)
        .leftJoin(groups, eq(homework.groupId, groups.id))
        .leftJoin(students, eq(homework.createdBy, students.id))
        .where(eq(homework.groupId, targetGroupId))
        .orderBy(desc(homework.createdAt))
        .limit(limit);

      await client.end();

      const homeworkList = homeworkResults.map(hw => ({
        id: hw.id,
        title: hw.title,
        description: hw.description,
        subject: hw.subject,
        dueDate: hw.dueDate?.toISOString() || null,
        groupName: hw.groupName || "Неизвестно",
        creatorName: hw.creatorFirstName ? `${hw.creatorFirstName} ${hw.creatorLastName || ''}`.trim() : null,
        createdAt: hw.createdAt?.toISOString() || "",
      }));

      logger?.info('✅ [ViewHomeworkTool] Retrieved homework list:', homeworkList.length);

      return {
        success: true,
        homeworkList,
        message: homeworkList.length > 0 
          ? `Найдено ${homeworkList.length} домашних заданий`
          : "Домашние задания не найдены"
      };

    } catch (error) {
      logger?.error('❌ [ViewHomeworkTool] Error viewing homework:', error);
      return { success: false, homeworkList: [], message: "Произошла ошибка при получении домашних заданий" };
    }
  },
});

// Tool for deleting homework
export const deleteHomeworkTool = createTool({
  id: "delete-homework-tool",
  description: "Delete homework assignment (only for monitors, admins, and owners)",
  inputSchema: z.object({
    telegramUserId: z.number().describe("Telegram ID of the person deleting homework"),
    homeworkId: z.number().describe("ID of homework to delete"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ context: { telegramUserId, homeworkId }, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [DeleteHomeworkTool] Starting homework deletion with params:', {
      telegramUserId, homeworkId
    });

    try {
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) {
        logger?.error('❌ [DeleteHomeworkTool] Database connection string not found');
        return { success: false, message: "Ошибка подключения к базе данных" };
      }

      const client = postgres(connectionString);
      const db = drizzle(client);

      // Verify user has permission
      const user = await db
        .select({
          id: students.id,
          accessLevel: students.accessLevel,
        })
        .from(students)
        .where(eq(students.telegramUserId, telegramUserId))
        .limit(1);

      if (user.length === 0) {
        await client.end();
        logger?.info('❌ [DeleteHomeworkTool] User not found in database');
        return { success: false, message: "Пользователь не найден в базе данных" };
      }

      const userData = user[0];
      const hasPermission = ['monitor', 'admin', 'owner'].includes(userData.accessLevel || 'student');

      if (!hasPermission) {
        await client.end();
        logger?.info('❌ [DeleteHomeworkTool] User lacks permission:', userData.accessLevel);
        return { 
          success: false, 
          message: "У вас нет прав для удаления домашних заданий. Обратитесь к старосте или администратору."
        };
      }

      // Check if homework exists and get its details
      const existingHomework = await db
        .select({ id: homework.id, title: homework.title })
        .from(homework)
        .where(eq(homework.id, homeworkId))
        .limit(1);

      if (existingHomework.length === 0) {
        await client.end();
        logger?.info('❌ [DeleteHomeworkTool] Homework not found:', homeworkId);
        return { success: false, message: "Домашнее задание не найдено" };
      }

      // Delete homework
      await db.delete(homework).where(eq(homework.id, homeworkId));

      await client.end();

      logger?.info('✅ [DeleteHomeworkTool] Homework deleted successfully:', homeworkId);

      return {
        success: true,
        message: `Домашнее задание "${existingHomework[0].title}" успешно удалено.`
      };

    } catch (error) {
      logger?.error('❌ [DeleteHomeworkTool] Error deleting homework:', error);
      return { success: false, message: "Произошла ошибка при удалении домашнего задания" };
    }
  },
});