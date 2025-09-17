import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";

export const sendTelegramMessageTool = createTool({
  id: "send-telegram-message-tool",
  description: "Send a message to Telegram user",
  inputSchema: z.object({
    chatId: z.number().describe("Telegram chat ID"),
    message: z.string().describe("Message text to send"),
    replyMarkup: z.object({
      inline_keyboard: z.array(z.array(z.object({
        text: z.string(),
        callback_data: z.string(),
      }))).optional(),
    }).optional().describe("Optional inline keyboard"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    messageId: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context: { chatId, message, replyMarkup }, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [SendTelegramMessageTool] Sending message with params:', {
      chatId, messageLength: message.length
    });

    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        logger?.error('❌ [SendTelegramMessageTool] TELEGRAM_BOT_TOKEN not found');
        return {
          success: false,
          error: "Bot token not configured"
        };
      }

      const payload: any = {
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      };

      if (replyMarkup && replyMarkup.inline_keyboard) {
        payload.reply_markup = replyMarkup;
      }

      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.text();
        logger?.error('❌ [SendTelegramMessageTool] Telegram API error:', {
          status: response.status,
          statusText: response.statusText,
          errorData
        });
        return {
          success: false,
          error: `Telegram API error: ${response.status} ${response.statusText}`
        };
      }

      const result = await response.json();
      
      logger?.info('✅ [SendTelegramMessageTool] Message sent successfully');

      return {
        success: true,
        messageId: result.result?.message_id,
      };

    } catch (error) {
      logger?.error('❌ [SendTelegramMessageTool] Error sending message:', error);
      return {
        success: false,
        error: String(error)
      };
    }
  },
});