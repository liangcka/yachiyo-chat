export type Locale = "zh-CN" | "ja-JP";

export type MessageStatus = "complete" | "streaming" | "failed" | "stopped";

export interface Conversation {
  id: string;
  title: string;
  locale: Locale;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  text: string;
  imageId?: string;
  status: MessageStatus;
  createdAt: number;
}

export type StoredImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export interface StoredImage {
  id: string;
  conversationId: string;
  blob: Blob;
  width: number;
  height: number;
  mimeType: StoredImageMimeType;
}
