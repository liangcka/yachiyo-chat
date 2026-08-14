import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { copyFor } from "../i18n/messages";
import { LlmSettingsPanel } from "./LlmSettingsPanel";

const copy = copyFor("zh-CN");
const VALID_KEY = "sk-test-abcdefghijklmnopqrstuvwxyz0123";

function mount(overrides: Partial<Parameters<typeof LlmSettingsPanel>[0]> = {}) {
  const props = {
    copy,
    open: true,
    entries: [] as const,
    onClose: vi.fn(),
    onSave: vi.fn(async () => undefined),
    onClear: vi.fn(async () => undefined),
    onActivate: vi.fn(async () => undefined),
    ...overrides,
  };
  return render(<LlmSettingsPanel {...props} />);
}

describe("LlmSettingsPanel", () => {
  it("renders nothing when closed", () => {
    const { container } = mount({ open: false });
    expect(container).toBeEmptyDOMElement();
  });

  it("lists providers grouped by domestic and international", () => {
    mount();
    const options = within(screen.getByLabelText("厂商")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "阶跃星辰 StepFun（Step Plan）",
      "DeepSeek",
      "智谱 GLM",
      "OpenAI (GPT)",
      "Anthropic (Claude)",
      "Google (Gemini)",
    ]);
  });

  it("shows the default-service hint when no active provider is set", () => {
    mount();
    expect(screen.getByText("未配置，使用默认服务")).toBeInTheDocument();
  });

  it("shows the active provider label when one is active", () => {
    mount({ activeProvider: "claude" });
    expect(screen.getByText("当前使用: Anthropic (Claude)")).toBeInTheDocument();
  });

  it("disables save while the key is empty", () => {
    mount();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("enables save and calls onSave with provider, key, and default model", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    mount({ onSave });

    await user.type(screen.getByPlaceholderText("API Key"), VALID_KEY);
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith("stepfun", VALID_KEY, "step-3.7-flash");
  });

  it("loads the existing entry when switching to a configured provider", async () => {
    const user = userEvent.setup();
    mount({
      entries: [{ provider: "openai", apiKey: VALID_KEY, model: "gpt-5.6-luna" }],
    });

    await user.selectOptions(screen.getByLabelText("厂商"), "openai");

    expect((screen.getByPlaceholderText("API Key") as HTMLInputElement).value).toBe(VALID_KEY);
    expect((screen.getByLabelText("模型") as HTMLSelectElement).value).toBe("gpt-5.6-luna");
  });

  it("hides the clear button until the selected provider has a stored config", () => {
    const { rerender } = mount();
    expect(screen.queryByRole("button", { name: "清除配置" })).not.toBeInTheDocument();

    rerender(
      <LlmSettingsPanel
        copy={copy}
        open
        entries={[{ provider: "stepfun", apiKey: VALID_KEY, model: "step-3.7-flash" }]}
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
        onClear={vi.fn(async () => undefined)}
        onActivate={vi.fn(async () => undefined)}
      />,
    );
    expect(screen.getByRole("button", { name: "清除配置" })).toBeInTheDocument();
  });

  it("calls onClear when clearing a configured provider", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn(async () => undefined);
    mount({
      entries: [{ provider: "stepfun", apiKey: VALID_KEY, model: "step-3.7-flash" }],
      onClear,
    });

    await user.click(screen.getByRole("button", { name: "清除配置" }));
    expect(onClear).toHaveBeenCalledWith("stepfun");
  });

  it("reveals the activate button for a configured non-active provider", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn(async () => undefined);
    mount({
      activeProvider: "openai",
      entries: [
        { provider: "openai", apiKey: VALID_KEY, model: "gpt-5.6-luna" },
        { provider: "claude", apiKey: VALID_KEY, model: "claude-3-5-haiku-latest" },
      ],
      onActivate,
    });

    expect(screen.queryByRole("button", { name: "设为当前" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("厂商"), "claude");
    await user.click(screen.getByRole("button", { name: "设为当前" }));

    expect(onActivate).toHaveBeenCalledWith("claude");
  });

  it("toggles API key visibility", async () => {
    const user = userEvent.setup();
    mount();

    const input = screen.getByPlaceholderText("API Key") as HTMLInputElement;
    expect(input.type).toBe("password");

    await user.click(screen.getByLabelText("显示"));
    expect(input.type).toBe("text");

    await user.click(screen.getByLabelText("隐藏"));
    expect(input.type).toBe("password");
  });

  it("warns when the selected provider does not support images", async () => {
    const user = userEvent.setup();
    mount();

    expect(screen.queryByText("该厂商暂不支持图片输入")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("厂商"), "deepseek");

    expect(screen.getByText("该厂商暂不支持图片输入")).toBeInTheDocument();
  });
});
