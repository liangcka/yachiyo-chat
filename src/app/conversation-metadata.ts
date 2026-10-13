import { isUntitledConversation, parseConversationMetadata, type ConversationMetadata } from "../domain/conversation-metadata";
import type { ChatMessage, Conversation } from "../domain/chat";
import type { ActiveLlmConfig } from "../domain/llm";
import type { StreamChatFunction } from "./use-chat-controller";

/** JSON 转义后的长度也计入服务端单条消息预算。 */
function boundedData(key: string, text: string, maximum: number): string {
  const characters = [...text].slice(0, maximum);
  let encoded = JSON.stringify({ [key]: characters.join("") });
  while ([...encoded].length > 4000) {
    characters.splice(Math.floor(characters.length * 0.8));
    encoded = JSON.stringify({ [key]: characters.join("") });
  }
  return encoded;
}

export async function generateConversationMetadata(options: {
  conversation: Conversation;
  user: ChatMessage;
  assistant: ChatMessage;
  memory: string;
  config?: ActiveLlmConfig;
  streamChat: StreamChatFunction;
  signal: AbortSignal;
  memoryOnly?: boolean;
}): Promise<ConversationMetadata | undefined> {
  const { conversation, user, assistant, memory, config, streamChat, signal } = options;
  const generateTitle = !options.memoryOnly && isUntitledConversation(conversation);
  const userData = JSON.stringify({ userText: user.text });
  const hasCompleteUserText = [...userData].length <= 4000;
  // 原文末尾可能包含更正，截断后的内容仅用于标题。
  const updateMemory = hasCompleteUserText && [...memory].length <= 2000 && JSON.stringify(memory).length <= 3500;
  if (!generateTitle && !updateMemory) return undefined;
  let text = "";
  const result = await streamChat({
    locale: conversation.locale,
    mode: "metadata",
    messages: [
      { role: "user", text: JSON.stringify({ generateTitle, updateMemory, existingMemory: updateMemory ? memory : "" }) },
      { role: "user", text: hasCompleteUserText ? userData : boundedData("userText", user.text, 4000) },
      { role: "user", text: boundedData("assistantText", assistant.text, 1000) },
    ],
    ...(config === undefined ? {} : { provider: config.provider, apiKey: config.apiKey, model: config.model }),
  }, {
    signal,
    onDelta(delta) { text += delta; },
  });
  if (signal.aborted || result.truncated) return undefined;
  const metadata = parseConversationMetadata(text);
  if (metadata === undefined) return undefined;
  return { title: generateTitle ? metadata.title : null, memory: updateMemory ? metadata.memory : null };
}
