import { describe, expect, it } from "vitest";
import { splitStickerPieces, stickerUrl, stripPartialStickerToken } from "./parse";

describe("splitStickerPieces", () => {
  it("returns plain text untouched", () => {
    expect(splitStickerPieces("  彩叶～  ")).toEqual([{ kind: "text", text: "彩叶～" }]);
  });

  it("parses a full sticker token into a sticker piece", () => {
    const pieces = splitStickerPieces("[sticker:smile]");

    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({
      kind: "sticker",
      sticker: { id: "smile", file: "smile.jpg" },
    });
  });

  it("expands inline tokens into ordered text and sticker pieces", () => {
    const pieces = splitStickerPieces("好哦[sticker:smile]等你～");

    expect(pieces.map((piece) => piece.kind)).toEqual(["text", "sticker", "text"]);
  });

  it("drops unknown ids without splitting the surrounding text", () => {
    expect(splitStickerPieces("a[sticker:nope]b")).toEqual([{ kind: "text", text: "ab" }]);
  });
});

describe("stripPartialStickerToken", () => {
  it("removes an unterminated trailing token", () => {
    expect(stripPartialStickerToken("收到～[sticker:la")).toBe("收到～");
  });

  it("keeps terminated tokens for piece expansion", () => {
    expect(stripPartialStickerToken("收到～[sticker:smile]")).toBe("收到～[sticker:smile]");
  });

  it("leaves text without tokens untouched", () => {
    expect(stripPartialStickerToken("收到～")).toBe("收到～");
  });
});

describe("stickerUrl", () => {
  it("resolves the asset path against the app base url", () => {
    expect(stickerUrl({ id: "smile", file: "smile.jpg", alt: "", scenes: "" })).toMatch(
      /stickers\/smile\.jpg$/u,
    );
  });
});
