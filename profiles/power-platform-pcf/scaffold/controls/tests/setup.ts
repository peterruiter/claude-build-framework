// Test set-up for jsdom: unmount after every test (React Testing Library 12, the React 16 line,
// registers this itself only with test globals), and expose NodeFilter, which Fluent's focus
// manager (tabster) uses and vitest's jsdom environment does not put on the global object.
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

globalThis.NodeFilter ??= window.NodeFilter;

afterEach(() => {
  cleanup();
});
