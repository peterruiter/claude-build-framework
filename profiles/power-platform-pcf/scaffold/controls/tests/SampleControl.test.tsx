import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SampleControl } from "../SampleControl/SampleControl";
import { DEFAULT, expected, expectedCount, fieldContext, LANGUAGES, resx, UNCONFIGURED, type FieldOptions } from "./mockContext";

const T = (key: string, ...args: (string | number)[]) => expected("SampleControl", key, args);
const N = (key: string, count: number) => expectedCount("SampleControl", key, count);

function mount(options: FieldOptions = {}) {
  const control = new SampleControl();
  const notify = vi.fn();
  const context = fieldContext(options);
  control.init(context, notify);
  const view = render(control.updateView(context));
  return { control, notify, context, view };
}

describe("SampleControl (field)", () => {
  it("names the input after the column and counts characters with the right plural form", () => {
    mount({ value: "Hello" });
    expect(screen.getByRole("textbox", { name: "Account name" })).toHaveProperty("value", "Hello");
    expect(screen.getByText(N("field.counter", 5))).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "A" } });
    expect(screen.getByText(N("field.counter", 1))).toBeTruthy();
  });

  it("asks for the container size so the layout follows the space it is given", () => {
    const { context } = mount();
    expect(context.mode.trackContainerResize).toHaveBeenCalledWith(true);
  });

  it("reports a new value when the reader leaves the input, and only when it changed", () => {
    const { control, notify } = mount({ value: "Hello" });
    const input = screen.getByRole("textbox");
    fireEvent.blur(input);
    expect(notify).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "Hello there" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(control.getOutputs()).toEqual({ value: "Hello there" });
  });

  it("clears to an empty column through a button whose name says what it clears", () => {
    const { control, notify } = mount({ value: "Hello" });
    const button = screen.getByRole("button", { name: T("field.clearLabel", "Account name") });
    expect(button.textContent).toBe(T("field.clear"));
    fireEvent.click(button);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(control.getOutputs()).toEqual({ value: undefined });
  });

  it("is read-only when the form is, or when field security does not allow editing", () => {
    mount({ disabled: true });
    expect(screen.getByRole("textbox")).toHaveProperty("disabled", true);
    mount({ editable: false });
    expect(screen.getAllByRole("textbox")[1]).toHaveProperty("disabled", true);
  });

  it("does not put a value the reader may not see into the page", () => {
    const { view } = mount({ value: "Confidential", readable: false });
    expect(view.container.textContent).not.toContain("Confidential");
    expect(screen.getByText(T("field.hidden"))).toBeTruthy();
  });

  it("counts down when the column has a maximum length", () => {
    mount({ value: "Hello", maxLength: 6 });
    expect(screen.getByText(N("field.remaining", 1))).toBeTruthy();
    expect(screen.getByRole("textbox")).toHaveProperty("maxLength", 6);
  });

  it("speaks every configured language from its own RESX file, without showing a key", () => {
    for (const lcid of LANGUAGES) {
      const { view } = mount({ value: "Hello", lcid, label: "Name" });
      const button = screen.getByRole("button", { name: expected("SampleControl", "field.clearLabel", ["Name"], lcid) });
      expect(button.textContent).toBe(expected("SampleControl", "field.clear", [], lcid));
      expect(screen.getByText(expectedCount("SampleControl", "field.counter", 5, lcid))).toBeTruthy();
      expect(view.container.textContent).not.toMatch(/\bfield\.[a-z]/);
      view.unmount();
    }
  });

  it("falls back to the default language when the environment has no file for the user's language", () => {
    // In an environment whose base language the control does not ship either, the platform has
    // no file and returns keys; the control shows the default language, built into the bundle.
    expect(resx("SampleControl", UNCONFIGURED)).toEqual({});
    const { view } = mount({ value: "Hej", lcid: UNCONFIGURED });
    expect(view.container.textContent).toContain(expected("SampleControl", "field.clear", [], DEFAULT));
    expect(view.container.textContent).not.toMatch(/\bfield\.[a-z]/);
  });

  it("writes nothing about the value to the console", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method));
    mount({ value: "jane.doe@example.com" });
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "jane.roe@example.com" } });
    fireEvent.blur(input);
    for (const spy of spies) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain("example.com");
    }
  });
});
