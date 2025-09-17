import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { students, groups } from "../../../shared/schema";
import { eq, and } from "drizzle-orm";

export const studentVerificationTool = createTool({
  id: "student-verification-tool",
  description: "Verify if a Telegram user is registered as a student and get their information",
  inputSchema: z.object({
    telegramUserId: z.number().describe("Telegram user ID to verify"),
    telegramUsername: z.string().optional().describe("Telegram username (if available)"),
  }),
  outputSchema: z.object({
    isVerified: z.boolean(),
    student: z.object({
      id: z.number(),
      studentId: z.string(),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
      groupId: z.number().nullable(),
      groupName: z.string().nullable(),
      accessLevel: z.string(),
      isActive: z.boolean(),
    }).nullable(),
    message: z.string(),
  }),
  execute: async ({ context: { telegramUserId, telegramUsername }, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [StudentVerificationTool] Starting verification with params:', {
      telegramUserId,
      telegramUsername
    });

    try {
      // Initialize database connection
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) {
        logger?.error('❌ [StudentVerificationTool] Database connection string not found');
        return {
          isVerified: false,
          student: null,
          message: "Ошибка подключения к базе данных"
        };
      }

      const client = postgres(connectionString);
      const db = drizzle(client);

      logger?.info('📝 [StudentVerificationTool] Searching for student...');

      // Query student with group information
      const result = await db
        .select({
          id: students.id,
          studentId: students.studentId,
          firstName: students.firstName,
          lastName: students.lastName,
          groupId: students.groupId,
          groupName: groups.groupName,
          accessLevel: students.accessLevel,
          isActive: students.isActive,
          telegramUsername: students.telegramUsername,
        })
        .from(students)
        .leftJoin(groups, eq(students.groupId, groups.id))
        .where(eq(students.telegramUserId, telegramUserId))
        .limit(1);

      await client.end();

      if (result.length === 0) {
        logger?.info('❌ [StudentVerificationTool] Student not found');
        return {
          isVerified: false,
          student: null,
          message: "Пользователь не найден в базе данных класса. Доступ запрещен."
        };
      }

      const student = result[0];

      // Check if student is active
      if (!student.isActive) {
        logger?.info('❌ [StudentVerificationTool] Student is inactive');
        return {
          isVerified: false,
          student: null,
          message: "Учетная запись студента деактивирована. Обратитесь к администратору."
        };
      }

      // Update username if provided and different
      if (telegramUsername && telegramUsername !== student.telegramUsername) {
        logger?.info('📝 [StudentVerificationTool] Updating username');
        try {
          const updateClient = postgres(connectionString);
          const updateDb = drizzle(updateClient);
          await updateDb
            .update(students)
            .set({ 
              telegramUsername,
              updatedAt: new Date()
            })
            .where(eq(students.telegramUserId, telegramUserId));
          await updateClient.end();
        } catch (error) {
          logger?.warn('⚠️ [StudentVerificationTool] Failed to update username:', error);
        }
      }

      logger?.info('✅ [StudentVerificationTool] Student verified successfully');

      return {
        isVerified: true,
        student: {
          id: student.id,
          studentId: student.studentId,
          firstName: student.firstName,
          lastName: student.lastName,
          groupId: student.groupId,
          groupName: student.groupName,
          accessLevel: student.accessLevel || "student",
          isActive: student.isActive || true,
        },
        message: `Добро пожаловать, ${student.firstName || telegramUsername || 'студент'}! Ваша группа: ${student.groupName || 'не назначена'}`
      };

    } catch (error) {
      logger?.error('❌ [StudentVerificationTool] Error during verification:', error);
      return {
        isVerified: false,
        student: null,
        message: "Произошла ошибка при проверке данных. Попробуйте позже."
      };
    }
  },
});