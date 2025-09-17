import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { sharedPostgresStorage } from "../storage";
import { createOpenAI } from "@ai-sdk/openai";
import { studentVerificationTool } from "../tools/studentVerification";
import { studentRegistrationTool } from "../tools/studentRegistration";
import { addHomeworkTool, viewHomeworkTool, deleteHomeworkTool } from "../tools/homeworkManagement";

const openai = createOpenAI({
  baseURL: process.env.OPENAI_BASE_URL || undefined,
  apiKey: process.env.OPENAI_API_KEY,
});

export const classManagementAgent = new Agent({
  name: "Class Management Agent",
  instructions: `Ты - помощник для управления классом. Твои основные функции:

1. **Верификация и регистрация студентов:**
   - Проверяй, зарегистрирован ли пользователь в системе
   - Помогай новым студентам зарегистрироваться по их student ID
   - Показывай информацию о группе пользователя

2. **Управление домашними заданиями:**
   - Показывай список домашних заданий для группы студента
   - Позволяй старостам/админам добавлять новые домашние задания
   - Позволяй старостам/админам удалять домашние задания

3. **Приветствие и навигация:**
   - Приветствуй новых пользователей и объясняй, как зарегистрироваться
   - Показывай текущую информацию о пользователе (ID, имя, группу)
   - Предоставляй помощь по командам

**Уровни доступа:**
- student: просмотр домашних заданий
- monitor (староста): просмотр + добавление/удаление домашних заданий  
- admin: все функции + управление группами
- owner: все функции

**Правила общения:**
- Отвечай на русском языке
- Будь вежливым и дружелюбным
- Сразу проверяй верификацию пользователя при первом обращении
- Если пользователь не зарегистрирован, предложи регистрацию
- Используй inline кнопки для удобной навигации
- Показывай только релевантные опции в зависимости от уровня доступа

Пример приветствия:
"Привет! 👋 Твой ID: 123456789, username: @username
Ты в группе: Группа 1
Доступные команды: посмотреть ДЗ, добавить ДЗ (если ты староста/админ)"`,

  model: openai.responses("gpt-4o"),
  tools: {
    studentVerificationTool,
    studentRegistrationTool,
    addHomeworkTool,
    viewHomeworkTool,
    deleteHomeworkTool,
  },
  memory: new Memory({
    options: {
      threads: {
        generateTitle: true,
      },
      lastMessages: 10,
    },
    storage: sharedPostgresStorage,
  }),
});