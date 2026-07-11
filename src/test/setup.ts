import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { vi } from "vitest";

const matchMedia = vi.fn((query: string): MediaQueryList => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(() => false),
}));

vi.stubGlobal("matchMedia", matchMedia);
vi.stubGlobal(
  "fetch",
  vi.fn(() => Promise.reject(new Error("Network access is disabled in unit tests."))),
);
