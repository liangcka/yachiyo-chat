import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { copyFor } from "../i18n/messages";
import { SettingsPanel, type SettingsPanelProps } from "./SettingsPanel";

function mount(overrides: Partial<SettingsPanelProps> = {}) {
  const props: SettingsPanelProps = {
    activeProvider: undefined,
    activeSkillIds: [],
    copy: copyFor("zh-CN"),
    entries: [],
    multiBubble: true,
    onClose: vi.fn(),
    onLlmActivate: vi.fn(async () => undefined),
    onLlmClear: vi.fn(async () => undefined),
    onLlmSave: vi.fn(async () => undefined),
    onMultiBubbleChange: vi.fn(),
    onSkillToggle: vi.fn(),
    onWebSearchSettingsChange: vi.fn(),
    open: true,
    skills: [
      {
        content: "深入思考提示词内容",
        description: "增强推理深度",
        id: "deep-reasoning",
        name: "深度思考",
      },
    ],
    userMemory: "用户喜欢简洁的回复",
    webSearchSettings: {
      enabled: false,
      showSources: false,
      smart: false,
    },
    ...overrides,
  };

  return {
    ...render(<SettingsPanel {...props} />),
    props,
  };
}

describe("SettingsPanel", () => {
  it("supports arrow and Home/End navigation through one tab stop", async () => {
    const user = userEvent.setup();
    mount();
    const model = screen.getByRole("tab", { name: /LLM 设置/ });
    const preferences = screen.getByRole("tab", { name: /聊天偏好/ });
    const skills = screen.getByRole("tab", { name: /技能/ });
    expect(preferences).toHaveAttribute("tabindex", "-1");
    model.focus();
    await user.keyboard("{ArrowRight}");
    expect(preferences).toHaveFocus();
    expect(preferences).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{End}");
    expect(skills).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(model).toHaveFocus();
    await user.keyboard("{ArrowLeft}{Home}");
    expect(model).toHaveFocus();
  });

  it("loads the saved provider configuration on first opening", () => {
    mount({
      activeProvider: "deepseek",
      entries: [{ provider: "deepseek", apiKey: "sk-saved-api-key", model: "deepseek-v4-pro" }],
    });
    expect(screen.getByLabelText("API Key")).toHaveValue("sk-saved-api-key");
    expect(screen.getByLabelText("模型")).toHaveValue("deepseek-v4-pro");
  });

  it("keeps save feedback when the saved configuration refreshes", async () => {
    const user = userEvent.setup();
    const { props, rerender } = mount();
    await user.selectOptions(screen.getByLabelText("厂商"), "deepseek");
    await user.selectOptions(screen.getByLabelText("模型"), "deepseek-v4-pro");
    await user.type(screen.getByLabelText("API Key"), "sk-settings-ui-test-key");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(props.onLlmSave).toHaveBeenCalledWith("deepseek", "sk-settings-ui-test-key", "deepseek-v4-pro");
    rerender(<SettingsPanel {...props} activeProvider="deepseek" entries={[
      { provider: "deepseek", apiKey: "sk-settings-ui-test-key", model: "deepseek-v4-pro" },
    ]} />);
    expect(screen.getByRole("status")).toHaveTextContent("配置已保存");
    expect(screen.getByLabelText("模型")).toHaveValue("deepseek-v4-pro");
  });

  it("resets key visibility and loads the next provider when switching", async () => {
    const user = userEvent.setup();
    mount({
      activeProvider: "deepseek",
      entries: [{ provider: "deepseek", apiKey: "sk-saved-api-key", model: "deepseek-v4-pro" }],
    });
    await user.click(screen.getByRole("button", { name: "显示" }));
    expect(screen.getByLabelText("API Key")).toHaveAttribute("type", "text");
    await user.selectOptions(screen.getByLabelText("厂商"), "glm");
    expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();
    expect(screen.getByLabelText("模型")).toHaveValue("glm-4.7-flash");
    await user.selectOptions(screen.getByLabelText("模型"), "charglm-4");
    expect(screen.getByLabelText("API Key")).toHaveValue("");
    expect(screen.getByLabelText("API Key")).toHaveAttribute("type", "password");
  });

  it("Flash 无需 Key 即可保存，charGLM 显示推荐并要求 Key", async () => {
    const user = userEvent.setup();
    const { props } = mount();

    expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();
    expect(screen.getByText("使用服务端 GLM-4.7-Flash，无需填写 API Key。")).toBeVisible();
    expect(screen.getByRole("button", { name: /^GLM-4\.7-Flash/ })).not.toHaveTextContent("推荐");
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(props.onLlmSave).toHaveBeenCalledWith("glm", "", "glm-4.7-flash");

    await user.selectOptions(screen.getByLabelText("模型"), "charglm-4");
    expect(screen.getByRole("button", { name: /^charGLM-4/ })).toHaveTextContent("推荐");
    expect(screen.getByLabelText("API Key")).toHaveValue("");
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    await user.type(screen.getByLabelText("API Key"), "sk-settings-ui-test-key");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(props.onLlmSave).toHaveBeenCalledWith("glm", "sk-settings-ui-test-key", "charglm-4");
  });

  it("无 Key Flash 配置可以设为当前和清除", async () => {
    const user = userEvent.setup();
    const { props } = mount({ entries: [{ provider: "glm", apiKey: "", model: "glm-4.7-flash" }] });

    await user.click(screen.getByRole("button", { name: "设为当前" }));
    expect(props.onLlmActivate).toHaveBeenCalledWith("glm");
    await user.click(screen.getByRole("button", { name: "清除配置" }));
    expect(props.onLlmClear).toHaveBeenCalledWith("glm");
  });

  it("保存 Flash 后切回 charGLM 保留已存 Key", async () => {
    const user = userEvent.setup();
    const key = "sk-settings-ui-test-key";
    const { props } = mount({ entries: [{ provider: "glm", apiKey: key, model: "charglm-4" }] });

    await user.selectOptions(screen.getByLabelText("模型"), "glm-4.7-flash");
    expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(props.onLlmSave).toHaveBeenCalledWith("glm", key, "glm-4.7-flash");
    await user.selectOptions(screen.getByLabelText("模型"), "charglm-4");
    expect(screen.getByLabelText("API Key")).toHaveValue(key);
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  });

  it("renders tab navigation with accessibility attributes", () => {
    mount();

    const tablist = screen.getByRole("tablist", { name: "设置" });
    expect(tablist).toBeInTheDocument();

    const modelTab = screen.getByRole("tab", { name: /LLM 设置/ });
    const prefTab = screen.getByRole("tab", { name: /聊天偏好/ });
    const memoryTab = screen.getByRole("tab", { name: /记忆/ });
    const skillsTab = screen.getByRole("tab", { name: /技能/ });

    expect(modelTab).toHaveAttribute("aria-selected", "true");
    expect(prefTab).toHaveAttribute("aria-selected", "false");
    expect(memoryTab).toHaveAttribute("aria-selected", "false");
    expect(skillsTab).toHaveAttribute("aria-selected", "false");
  });

  it("switches to preferences tab and toggles multi-bubble and web search", async () => {
    const user = userEvent.setup();
    const onMultiBubbleChange = vi.fn();
    const onWebSearchSettingsChange = vi.fn();

    mount({
      onMultiBubbleChange,
      onWebSearchSettingsChange,
    });

    // 切换到聊天偏好 Tab
    const prefTab = screen.getByRole("tab", { name: /聊天偏好/ });
    await user.click(prefTab);
    expect(prefTab).toHaveAttribute("aria-selected", "true");

    // 验证多气泡消息卡片
    expect(screen.getByText("分条发送消息")).toBeVisible();
    const multiBubbleBtn = screen.getByRole("button", {
      name: "切换技能启用状态: 分条发送消息",
    });
    expect(multiBubbleBtn).toHaveAttribute("aria-pressed", "true");
    await user.click(multiBubbleBtn);
    expect(onMultiBubbleChange).toHaveBeenCalledWith(false);

    // 验证联网搜索卡片
    expect(screen.getByText("联网搜索")).toBeVisible();
    const webSearchBtn = screen.getByRole("button", {
      name: "切换技能启用状态: 联网搜索",
    });
    expect(webSearchBtn).toHaveAttribute("aria-pressed", "false");
    await user.click(webSearchBtn);
    expect(onWebSearchSettingsChange).toHaveBeenCalledWith({ enabled: true });
  });

  it("opens directly to specified initialTab", () => {
    mount({ initialTab: "memory" });

    const memoryTab = screen.getByRole("tab", { name: /记忆/ });
    expect(memoryTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("用户喜欢简洁的回复")).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText("保存记忆")).not.toBeInTheDocument();
    expect(screen.queryByText("清除记忆")).not.toBeInTheDocument();
    expect(screen.queryByText("撤销这次变更")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "记忆变更记录" })).not.toBeInTheDocument();
  });

  it("shows the memory empty state and refreshes read-only content", () => {
    const { props, rerender } = mount({ initialTab: "memory", userMemory: "  " });
    expect(screen.getByText(props.copy.userMemoryPlaceholder)).toBeVisible();
    rerender(<SettingsPanel {...props} userMemory={"喜欢绿茶。\n住在东京。"} />);
    expect(screen.getByText(/喜欢绿茶。/)).toHaveTextContent("喜欢绿茶。 住在东京。");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("switches to skills tab and renders skills list", async () => {
    const user = userEvent.setup();
    const onSkillToggle = vi.fn();

    mount({ onSkillToggle });

    const skillsTab = screen.getByRole("tab", { name: /技能/ });
    await user.click(skillsTab);

    expect(screen.getByText("深度思考")).toBeVisible();
    expect(screen.getByText("增强推理深度")).toBeVisible();

    const toggleBtn = screen.getByRole("button", {
      name: "切换技能启用状态: 深度思考",
    });
    await user.click(toggleBtn);
    expect(onSkillToggle).toHaveBeenCalledWith("deep-reasoning", true);
  });

  it("calls onClose on close button click or Escape key", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    const { container } = mount({ onClose });

    const closeBtn = screen.getByRole("button", { name: "关闭菜单" });
    await user.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);

    const dialog = container.querySelector("dialog");
    expect(dialog).not.toBeNull();
    if (dialog) {
      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(2);
    }
  });
});
