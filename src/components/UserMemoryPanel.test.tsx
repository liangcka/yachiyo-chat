import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { copyFor } from "../i18n/messages";
import { UserMemoryPanel } from "./UserMemoryPanel";

const copy = copyFor("zh-CN");

function mount(overrides: Partial<Parameters<typeof UserMemoryPanel>[0]> = {}) {
  const props = {
    copy,
    memory: "彩叶喜欢草莓大福",
    open: true,
    onClose: vi.fn(),
    onSave: vi.fn(async () => true),
    ...overrides,
  };
  return render(<UserMemoryPanel {...props} />);
}

function editor(): HTMLTextAreaElement {
  return screen.getByRole("textbox");
}

describe("UserMemoryPanel", () => {
  it("renders nothing when closed", () => {
    const { container } = mount({ open: false });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the existing memory in the editor", () => {
    mount();
    expect(editor()).toHaveValue("彩叶喜欢草莓大福");
    expect(screen.getByText(copy.userMemoryDescription)).toBeInTheDocument();
  });

  it("calls onSave with the edited draft", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => true);
    mount({ onSave });

    await user.clear(editor());
    await user.type(editor(), "彩叶喜欢猫");
    await user.click(screen.getByRole("button", { name: "保存记忆" }));

    expect(onSave).toHaveBeenCalledWith("彩叶喜欢猫");
  });

  it("disables the clear button when the editor becomes empty", async () => {
    const user = userEvent.setup();
    mount();

    const clearButton = screen.getByRole("button", { name: "清除记忆" });
    expect(clearButton).toBeEnabled();

    await user.clear(editor());
    expect(clearButton).toBeDisabled();
  });

  it("reflects memory changes when reopened", () => {
    const { rerender } = mount({ memory: "旧记忆" });
    expect(editor()).toHaveValue("旧记忆");

    rerender(
      <UserMemoryPanel
        copy={copy}
        memory="新记忆"
        open
        onClose={vi.fn()}
        onSave={vi.fn(async () => true)}
      />,
    );
    expect(editor()).toHaveValue("新记忆");
  });
});
