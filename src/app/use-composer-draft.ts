import { useCallback, useState } from "react";
import type { StoredImage } from "../domain/chat";
import type { ProcessedImage } from "../features/capture/image-processor";
import type { ChatController, RecalledMessageData } from "./chat/contracts";

export interface ComposerDraftOptions {
  controller: Pick<ChatController, "activeConversation" | "send" | "setPendingImage">;
  getImage: (id: string) => Promise<StoredImage | undefined>;
  registerImageUrl: (id: string, blob: Blob) => string | undefined;
}

export interface ComposerDraft {
  value: string;
  setValue(value: string): void;
  pendingImageDataUrl?: string;
  attachImage(image: ProcessedImage): void;
  removeImage(): void;
  send(text: string): void;
  /** 撤回后把原消息的文字与图片放回输入区 */
  restore(recalled: RecalledMessageData): Promise<void>;
  clear(): void;
}

/** 输入区草稿：文字与待发送图片预览，图片实体由控制器持有直到发送。 */
export function useComposerDraft({
  controller,
  getImage,
  registerImageUrl,
}: ComposerDraftOptions): ComposerDraft {
  const [value, setValue] = useState("");
  const [pendingImageDataUrl, setPendingImageDataUrl] = useState<string>();
  const conversationId = controller.activeConversation?.id;
  const { send: sendMessage, setPendingImage } = controller;

  const clear = useCallback(() => {
    setValue("");
    setPendingImageDataUrl(undefined);
  }, []);

  const attachImage = useCallback((image: ProcessedImage) => {
    if (conversationId === undefined) return;
    const imageId = crypto.randomUUID();
    registerImageUrl(imageId, image.blob);
    setPendingImage({
      blob: image.blob,
      conversationId,
      height: image.height,
      id: imageId,
      mimeType: image.mimeType,
      width: image.width,
    });
    setPendingImageDataUrl(image.dataUrl);
  }, [conversationId, registerImageUrl, setPendingImage]);

  const removeImage = useCallback(() => {
    setPendingImage(undefined);
    setPendingImageDataUrl(undefined);
  }, [setPendingImage]);

  const send = useCallback((text: string) => {
    void sendMessage(text);
    clear();
  }, [clear, sendMessage]);

  const restore = useCallback(async (recalled: RecalledMessageData) => {
    setValue(recalled.text);
    if (!recalled.imageId) return;
    const image = await getImage(recalled.imageId);
    if (image === undefined) return;
    setPendingImage(image);
    const url = registerImageUrl(image.id, image.blob);
    if (url !== undefined) setPendingImageDataUrl(url);
  }, [getImage, registerImageUrl, setPendingImage]);

  return { value, setValue, pendingImageDataUrl, attachImage, removeImage, send, restore, clear };
}
