import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { copyFor } from "../i18n/messages";
import { OnboardingGuide, type OnboardingGuideProps } from "./OnboardingGuide";

function props(overrides: Partial<OnboardingGuideProps> = {}): OnboardingGuideProps {
  return {
    copy: copyFor("zh-CN"),
    open: true,
    onClose: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  };
}

describe("新手引导", () => {
  it("展示三步进度，支持前进与返回", async () => {
    const user = userEvent.setup();
    const guideProps = props();
    render(<OnboardingGuide {...guideProps} />);
    expect(screen.getByRole("dialog", { name: guideProps.copy.onboardingTitle })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: guideProps.copy.onboardingWelcomeTitle })).toBeVisible();
    expect(screen.getByText("第 1 步，共 3 步")).toBeVisible();
    expect(screen.queryByRole("button", { name: guideProps.copy.onboardingBack })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: guideProps.copy.onboardingNext }));
    expect(screen.getByRole("heading", { name: guideProps.copy.onboardingModelTitle })).toBeVisible();
    expect(screen.getByText(/默认服务使用 GLM-4.7-Flash/u)).toBeVisible();
    await user.click(screen.getByRole("button", { name: guideProps.copy.onboardingBack }));
    expect(screen.getByRole("heading", { name: guideProps.copy.onboardingWelcomeTitle })).toBeVisible();
  });

  it("允许跳过引导或在最后一步完成", async () => {
    const user = userEvent.setup();
    const guideProps = props();
    render(<OnboardingGuide {...guideProps} />);
    await user.click(screen.getByRole("button", { name: guideProps.copy.onboardingSkip }));
    expect(guideProps.onClose).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: guideProps.copy.onboardingNext }));
    await user.click(screen.getByRole("button", { name: guideProps.copy.onboardingNext }));
    expect(screen.getByRole("heading", { name: guideProps.copy.onboardingFeaturesTitle })).toBeVisible();
    await user.click(screen.getByRole("button", { name: guideProps.copy.onboardingStart }));
    expect(guideProps.onClose).toHaveBeenCalledTimes(2);
    expect(guideProps.onOpenSettings).not.toHaveBeenCalled();
  });

  it("最后一步可以前往模型设置", async () => {
    const user = userEvent.setup();
    const guideProps = props();
    render(<OnboardingGuide {...guideProps} />);
    await user.click(screen.getByRole("button", { name: guideProps.copy.onboardingNext }));
    await user.click(screen.getByRole("button", { name: guideProps.copy.onboardingNext }));
    await user.click(screen.getByRole("button", { name: guideProps.copy.onboardingOpenSettings }));
    expect(guideProps.onOpenSettings).toHaveBeenCalledOnce();
  });

  it("重新打开时从第一步开始", async () => {
    const user = userEvent.setup();
    const guideProps = props();
    const { rerender } = render(<OnboardingGuide {...guideProps} />);
    await user.click(screen.getByRole("button", { name: guideProps.copy.onboardingNext }));
    rerender(<OnboardingGuide {...guideProps} open={false} />);
    rerender(<OnboardingGuide {...guideProps} open />);
    expect(screen.getByRole("heading", { name: guideProps.copy.onboardingWelcomeTitle })).toBeVisible();
    expect(screen.getByText("第 1 步，共 3 步")).toBeVisible();
  });

  it("聚焦跳过按钮，限制 Tab 焦点，并在 Escape 关闭后还原焦点", async () => {
    const user = userEvent.setup();
    const guideProps = props();
    const { rerender } = render(<><button type="button">重看引导</button><OnboardingGuide {...guideProps} open={false} /></>);
    const trigger = screen.getByRole("button", { name: "重看引导" });
    trigger.focus();
    rerender(<><button type="button">重看引导</button><OnboardingGuide {...guideProps} /></>);
    const skip = screen.getByRole("button", { name: guideProps.copy.onboardingSkip });
    const next = screen.getByRole("button", { name: guideProps.copy.onboardingNext });
    expect(skip).toHaveFocus();
    await user.tab({ shift: true });
    expect(next).toHaveFocus();
    await user.tab();
    expect(skip).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(guideProps.onClose).toHaveBeenCalledOnce();
    rerender(<><button type="button">重看引导</button><OnboardingGuide {...guideProps} open={false} /></>);
    expect(trigger).toHaveFocus();
  });

  it("关闭时不挂载，日语文案覆盖每一步", async () => {
    const user = userEvent.setup();
    const guideProps = props({ copy: copyFor("ja-JP"), open: false });
    const { rerender } = render(<OnboardingGuide {...guideProps} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<OnboardingGuide {...guideProps} open />);
    expect(screen.getByRole("heading", { name: guideProps.copy.onboardingWelcomeTitle })).toBeVisible();
    await user.click(screen.getByRole("button", { name: guideProps.copy.onboardingNext }));
    expect(screen.getByRole("heading", { name: guideProps.copy.onboardingModelTitle })).toBeVisible();
    await user.click(screen.getByRole("button", { name: guideProps.copy.onboardingNext }));
    expect(screen.getByRole("heading", { name: guideProps.copy.onboardingFeaturesTitle })).toBeVisible();
    expect(screen.getByRole("button", { name: guideProps.copy.onboardingStart })).toBeVisible();
  });
});
