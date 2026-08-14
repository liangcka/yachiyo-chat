import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToastRegion } from "./ToastRegion";

describe("ToastRegion", () => {
  it("keeps stable live regions while replaying repeated announcement motion", () => {
    const view = render(<ToastRegion />);
    const statusRegion = screen.getByRole("status");
    const alertRegion = screen.getByRole("alert");
    expect(statusRegion).toHaveAttribute("aria-atomic", "true");
    expect(alertRegion).toHaveAttribute("aria-atomic", "true");

    view.rerender(<ToastRegion announcementId={1} message="即将开放" />);
    const firstToast = view.container.querySelector(".toast");
    expect(statusRegion).toHaveTextContent("即将开放");
    expect(alertRegion).toBeEmptyDOMElement();

    view.rerender(<ToastRegion announcementId={2} message="即将开放" />);

    expect(screen.getByRole("status")).toBe(statusRegion);
    expect(view.container.querySelector(".toast")).not.toBe(firstToast);

    view.rerender(<ToastRegion announcementId={3} message="连接失败" tone="error" />);
    expect(statusRegion).toBeEmptyDOMElement();
    expect(alertRegion).toHaveTextContent("连接失败");
  });
});
