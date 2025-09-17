import { createWorkflow, createStep } from "../inngest";
import { classManagementAgent } from "../agents/classManagementAgent";
import { z } from "zod";

const step1 = createStep({
  id: "use-agent",
  description: "Process Telegram message with class management agent",
  inputSchema: z.object({
    message: z.string(),
    threadId: z.string(),
    chatId: z.number(),
    username: z.string().optional(),
    telegramUserId: z.number(),
  }),
  outputSchema: z.object({
    response: z.string(),
    chatId: z.number(),
  }),
  execute: async ({ inputData }) => {
    const { message, threadId, chatId, username, telegramUserId } = inputData;
    
    // Include user context in the message
    const contextualMessage = `Сообщение от пользователя: ${message}
Telegram ID: ${telegramUserId}
Username: ${username || 'не указан'}
Chat ID: ${chatId}`;

    const { text } = await classManagementAgent.generate([
      { role: "user", content: contextualMessage }
    ], {
      resourceId: "bot",
      threadId: threadId,
      maxSteps: 5,
    });

    return { 
      response: text,
      chatId: chatId
    };
  }
});

const step2 = createStep({
  id: "send-telegram-reply",
  description: "Send agent response back to Telegram",
  inputSchema: z.object({
    response: z.string(),
    chatId: z.number(),
  }),
  outputSchema: z.object({
    sent: z.boolean(),
  }),
  execute: async ({ inputData }) => {
    const { response, chatId } = inputData;

    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        console.error('TELEGRAM_BOT_TOKEN not found');
        return { sent: false };
      }

      const payload = {
        chat_id: chatId,
        text: response,
        parse_mode: 'HTML',
      };

      const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!telegramResponse.ok) {
        console.error('Telegram API error:', await telegramResponse.text());
        return { sent: false };
      }

      return { sent: true };

    } catch (error) {
      console.error('Error sending Telegram message:', error);
      return { sent: false };
    }
  }
});

export const classManagementWorkflow = createWorkflow({
  id: "class-management-workflow",
  description: "Handle class management interactions via Telegram",
  inputSchema: z.object({
    message: z.string(),
    threadId: z.string(),
    chatId: z.number(),
    username: z.string().optional(),
    telegramUserId: z.number(),
  }),
  outputSchema: z.object({
    sent: z.boolean(),
  })
})
  .then(step1)
  .then(step2)
  .commit();