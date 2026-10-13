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
    expect(screen.getByLabelText("厂商")).toHaveValue("glm");
    expect(screen.getByLabelText("模型")).toHaveValue("glm-4.7-flash");
  });

  it("GLM 预设列表不再包含 GLM-4.6 系列", () => {
    mount();
    const models = within(screen.getByLabelText("模型")).getAllByRole("option");

    expect(models.map((option) => (option as HTMLOptionElement).value)).toEqual([
      "glm-4.7-flash", "charglm-4", "glm-5.3", "glm-5.3-flash",
    ]);
  });

  it("shows the active provider label when one is active", () => {
    mount({ activeProvider: "claude" });
    expect(screen.getByText("当前使用: Anthropic (Claude)")).toBeInTheDocument();
    expect(screen.getByLabelText("厂商")).toHaveValue("claude");
  });

  it("charGLM 需要有效的个人 API Key", async () => {
    const user = userEvent.setup();
    mount();
    await user.selectOptions(screen.getByLabelText("模型"), "charglm-4");
    expect(screen.getByLabelText("API Key")).toHaveValue("");
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("GLM-4.7-Flash 隐藏 Key 输入并允许直接保存", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    mount({ onSave });

    expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();
    expect(screen.getByText("使用服务端 GLM-4.7-Flash，无需填写 API Key。")).toBeVisible();
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith("glm", "", "glm-4.7-flash");
  });

  it("charGLM 使用有效 Key 保存", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    mount({ onSave });

    await user.selectOptions(screen.getByLabelText("模型"), "charglm-4");
    await user.type(screen.getByPlaceholderText("API Key"), VALID_KEY);
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith("glm", VALID_KEY, "charglm-4");
  });

  it("保存服务端 Flash 后切回 charGLM 保留个人 Key", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    mount({
      entries: [{ provider: "glm", apiKey: VALID_KEY, model: "charglm-4" }],
      onSave,
    });

    await user.selectOptions(screen.getByLabelText("模型"), "glm-4.7-flash");
    expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith("glm", VALID_KEY, "glm-4.7-flash");

    await user.selectOptions(screen.getByLabelText("模型"), "charglm-4");
    expect(screen.getByLabelText("API Key")).toHaveValue(VALID_KEY);
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
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
        entries={[{ provider: "glm", apiKey: VALID_KEY, model: "glm-4.7-flash" }]}
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
      entries: [{ provider: "glm", apiKey: VALID_KEY, model: "glm-4.7-flash" }],
      onClear,
    });

    await user.click(screen.getByRole("button", { name: "清除配置" }));
    expect(onClear).toHaveBeenCalledWith("glm");
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

  it("已保存的无 Key Flash 可以设为当前和清除", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn(async () => undefined);
    const onClear = vi.fn(async () => undefined);
    mount({ entries: [{ provider: "glm", apiKey: "", model: "glm-4.7-flash" }], onActivate, onClear });

    await user.click(screen.getByRole("button", { name: "设为当前" }));
    expect(onActivate).toHaveBeenCalledWith("glm");
    await user.click(screen.getByRole("button", { name: "清除配置" }));
    expect(onClear).toHaveBeenCalledWith("glm");
  });

  it("toggles API key visibility", async () => {
    const user = userEvent.setup();
    mount();

    await user.selectOptions(screen.getByLabelText("模型"), "charglm-4");
    const input = screen.getByPlaceholderText("API Key") as HTMLInputElement;
    expect(input.type).toBe("password");

    await user.click(screen.getByLabelText("显示"));
    expect(input.type).toBe("text");

    await user.click(screen.getByLabelText("隐藏"));
    expect(input.type).toBe("password");
  });

  it("warns when the selected model does not support images", async () => {
    const user = userEvent.setup();
    mount();

    expect(screen.getByText("该厂商暂不支持图片输入")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("模型"), "glm-5.3-flash");
    expect(screen.queryByText("该厂商暂不支持图片输入")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("厂商"), "deepseek");
    await user.selectOptions(screen.getByLabelText("模型"), "deepseek-v4-pro");

    expect(screen.getByText("该厂商暂不支持图片输入")).toBeInTheDocument();
  });

  it("推荐标记属于 charGLM，默认 Flash 保留免费标记", async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.getByRole("button", { name: /^GLM-4\.7-Flash/ })).not.toHaveTextContent("推荐");
    await user.selectOptions(screen.getByLabelText("模型"), "charglm-4");
    expect(screen.getByRole("button", { name: /^charGLM-4/ })).toHaveTextContent("推荐");
  });

  it("默认模型展示免费徽章", () => {
    mount();
    expect(screen.getAllByText("免费").length).toBeGreaterThan(0);
  });

  it("renders model names according to display casing rules", async () => {
    const user = userEvent.setup();
    mount();

    expect(screen.getAllByText("GLM-4.7-Flash").length).toBeGreaterThan(0);
    expect(screen.getAllByText("charGLM-4").length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByLabelText("厂商"), "stepfun");
    expect(screen.getAllByText("step-3.7-flash").length).toBeGreaterThan(0);

    // 切换至 claude：Claude 首字母大写
    await user.selectOptions(screen.getByLabelText("厂商"), "claude");
    expect(screen.getAllByText("Claude-sonnet-5-5").length).toBeGreaterThan(0);

    // 切换至 gemini：Gemini 首字母大写
    await user.selectOptions(screen.getByLabelText("厂商"), "gemini");
    expect(screen.getAllByText("Gemini-3.8-flash").length).toBeGreaterThan(0);

    // 切换至 openai：GPT 全大写
    await user.selectOptions(screen.getByLabelText("厂商"), "openai");
    expect(screen.getAllByText("GPT-6-luna").length).toBeGreaterThan(0);
  });
});
