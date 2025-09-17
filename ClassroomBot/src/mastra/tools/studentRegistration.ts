import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { students, groups } from "../../../shared/schema";
import { eq, and } from "drizzle-orm";

// Predefined student IDs and their group assignments
// You can modify this data according to your class roster
const AUTHORIZED_STUDENTS: Record<string, { 
  groupId: number, 
  firstName?: string, 
  lastName?: string,
  accessLevel: "student" | "admin" | "monitor" | "owner"
}> = {
  // Example student IDs - replace with your actual class roster
  "ST001": { groupId: 1, firstName: "Иван", lastName: "Петров", accessLevel: "student" },
  "ST002": { groupId: 1, firstName: "Мария", lastName: "Сидорова", accessLevel: "monitor" },
  "ST003": { groupId: 2, firstName: "Алексей", lastName: "Козлов", accessLevel: "student" },
  "ST004": { groupId: 2, firstName: "Анна", lastName: "Волкова", accessLevel: "admin" },
  "ST005": { groupId: 3, firstName: "Дмитрий", lastName: "Новиков", accessLevel: "owner" },
  "ST006": { groupId: 3, firstName: "Екатерина", lastName: "Смирнова", accessLevel: "student" },
  // Add more students as needed...
};

export const studentRegistrationTool = createTool({
  id: "student-registration-tool",
  description: "Register a new student in the system based on their student ID",
  inputSchema: z.object({
    telegramUserId: z.number().describe("Telegram user ID"),
    telegramUsername: z.string().optional().describe("Telegram username (if available)"),
    studentId: z.string().describe("Student ID to verify against authorized list"),
    firstName: z.string().optional().describe("First name (if provided by user)"),
    lastName: z.string().optional().describe("Last name (if provided by user)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    student: z.object({
      id: z.number(),
      studentId: z.string(),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
      groupId: z.number(),
      groupName: z.string(),
      accessLevel: z.string(),
    }).nullable(),
    message: z.string(),
  }),
  execute: async ({ context: { telegramUserId, telegramUsername, studentId, firstName, lastName }, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [StudentRegistrationTool] Starting registration with params:', {
      telegramUserId,
      telegramUsername,
      studentId
    });

    try {
      // Check if student ID is authorized
      const authorizedStudent = AUTHORIZED_STUDENTS[studentId.toUpperCase()];
      if (!authorizedStudent) {
        logger?.info('❌ [StudentRegistrationTool] Student ID not authorized:', studentId);
        return {
          success: false,
          student: null,
          message: `ID студента "${studentId}" не найден в списке авторизованных. Доступ запрещен.`
        };
      }

      // Initialize database connection
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) {
        logger?.error('❌ [StudentRegistrationTool] Database connection string not found');
        return {
          success: false,
          student: null,
          message: "Ошибка подключения к базе данных"
        };
      }

      const client = postgres(connectionString);
      const db = drizzle(client);

      logger?.info('📝 [StudentRegistrationTool] Checking if student already exists...');

      // Check if student is already registered
      const existingStudent = await db
        .select()
        .from(students)
        .where(eq(students.studentId, studentId.toUpperCase()))
        .limit(1);

      if (existingStudent.length > 0) {
        // Check if it's the same Telegram user
        if (existingStudent[0].telegramUserId === telegramUserId) {
          logger?.info('📝 [StudentRegistrationTool] Student already registered with same Telegram account');
          
          // Get group name
          const groupResult = await db
            .select({ groupName: groups.groupName })
            .from(groups)
            .where(eq(groups.id, existingStudent[0].groupId!))
            .limit(1);
          
          await client.end();
          
          return {
            success: true,
            student: {
              id: existingStudent[0].id,
              studentId: existingStudent[0].studentId,
              firstName: existingStudent[0].firstName,
              lastName: existingStudent[0].lastName,
              groupId: existingStudent[0].groupId!,
              groupName: groupResult[0]?.groupName || "Неизвестно",
              accessLevel: existingStudent[0].accessLevel || "student",
            },
            message: "Вы уже зарегистрированы в системе!"
          };
        } else {
          logger?.info('❌ [StudentRegistrationTool] Student ID already taken by different Telegram user');
          await client.end();
          return {
            success: false,
            student: null,
            message: `ID студента "${studentId}" уже используется другим пользователем Telegram.`
          };
        }
      }

      // Check if Telegram user is already registered with different student ID
      const existingTelegramUser = await db
        .select()
        .from(students)
        .where(eq(students.telegramUserId, telegramUserId))
        .limit(1);

      if (existingTelegramUser.length > 0) {
        logger?.info('❌ [StudentRegistrationTool] Telegram user already registered with different student ID');
        await client.end();
        return {
          success: false,
          student: null,
          message: `Ваш Telegram аккаунт уже связан с ID студента "${existingTelegramUser[0].studentId}".`
        };
      }

      logger?.info('📝 [StudentRegistrationTool] Registering new student...');

      // Register new student
      const newStudentData = {
        telegramUserId,
        telegramUsername: telegramUsername || null,
        studentId: studentId.toUpperCase(),
        firstName: firstName || authorizedStudent.firstName || null,
        lastName: lastName || authorizedStudent.lastName || null,
        groupId: authorizedStudent.groupId,
        accessLevel: authorizedStudent.accessLevel,
        isActive: true,
      };

      const insertResult = await db
        .insert(students)
        .values(newStudentData)
        .returning();

      // Get group name
      const groupResult = await db
        .select({ groupName: groups.groupName })
        .from(groups)
        .where(eq(groups.id, authorizedStudent.groupId))
        .limit(1);

      await client.end();

      const newStudent = insertResult[0];
      const groupName = groupResult[0]?.groupName || "Неизвестно";

      logger?.info('✅ [StudentRegistrationTool] Student registered successfully');

      return {
        success: true,
        student: {
          id: newStudent.id,
          studentId: newStudent.studentId,
          firstName: newStudent.firstName,
          lastName: newStudent.lastName,
          groupId: newStudent.groupId!,
          groupName,
          accessLevel: newStudent.accessLevel || "student",
        },
        message: `Добро пожаловать! Вы успешно зарегистрированы как ${newStudent.firstName || 'студент'} в группе "${groupName}".`
      };

    } catch (error) {
      logger?.error('❌ [StudentRegistrationTool] Error during registration:', error);
      return {
        success: false,
        student: null,
        message: "Произошла ошибка при регистрации. Попробуйте позже."
      };
    }
  },
});

// Export the authorized students list for potential admin use
export { AUTHORIZED_STUDENTS };