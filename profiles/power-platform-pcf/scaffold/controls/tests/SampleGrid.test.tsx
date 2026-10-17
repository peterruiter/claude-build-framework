import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SampleGrid } from "../SampleGrid/SampleGrid";
import { expected, expectedCount, gridContext, LANGUAGES, type GridOptions } from "./mockContext";

const T = (key: string, ...args: (string | number)[]) => expected("SampleGrid", key, args);
const N = (key: string, count: number) => expectedCount("SampleGrid", key, count);

function mount(options: GridOptions = {}) {
  const control = new SampleGrid();
  const { context, dataset } = gridContext(options);
  control.init(context);
  const view = render(control.updateView(context));
  const rerender = () => view.rerender(control.updateView(context));
  return { control, context, dataset, view, rerender };
}

describe("SampleGrid (dataset)", () => {
  it("shows the view's visible columns in their order, with the primary column as a link", () => {
    mount();
    const table = screen.getByRole("table", { name: "Active accounts" });
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers.filter(Boolean)).toEqual(["Account name", "City"]);
    expect(within(table).queryByText("Hidden column")).toBeNull();
    expect(screen.getByRole("button", { name: "Fourth Coffee" })).toBeTruthy();
    expect(screen.getByText(T("grid.untitled"))).toBeTruthy();
  });

  it("opens a record through the platform, by keyboard-reachable link", () => {
    const { dataset } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Litware" }));
    expect(dataset.openDatasetItem).toHaveBeenCalledWith(expect.objectContaining({ id: { guid: "a2" } }));
  });

  it("selects records with named checkboxes and tells the platform", () => {
    const { dataset } = mount();
    fireEvent.click(screen.getByRole("checkbox", { name: T("grid.select", "Fourth Coffee") }));
    expect(dataset.setSelectedRecordIds).toHaveBeenCalledWith(["a1"]);
    fireEvent.click(screen.getByRole("checkbox", { name: T("grid.selectAll") }));
    expect(dataset.setSelectedRecordIds).toHaveBeenLastCalledWith(["a1", "a2", "a3"]);
  });

  it("sorts by a column through the dataset and starts again at page 1", () => {
    const { dataset } = mount();
    fireEvent.click(screen.getByText("City"));
    expect(dataset.sorting).toEqual([{ name: "city", sortDirection: 0 }]);
    expect(dataset.refresh).toHaveBeenCalledTimes(1);
  });

  it("pages with loadExactPage and does not page while loading", () => {
    const { dataset, rerender } = mount({ hasNextPage: true, total: 120 });
    expect(screen.getByText(T("grid.page", 1))).toBeTruthy();
    expect(screen.getByText(N("grid.count", 120))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: T("grid.next") }));
    expect(dataset.paging.loadExactPage).toHaveBeenCalledWith(2);
    dataset.loading = true;
    rerender();
    expect(screen.getByRole("button", { name: T("grid.next") })).toHaveProperty("disabled", true);
  });

  it("leaves the total out when the host does not know it, and uses the singular for one record", () => {
    const unknown = mount({ total: -1 });
    expect(unknown.view.container.textContent).not.toContain(N("grid.count", 3));
    unknown.view.unmount();
    mount({ records: [{ id: "x", values: { name: "Only" } }], total: 1 });
    expect(screen.getByText(N("grid.count", 1))).toBeTruthy();
  });

  it("applies the page size property once", () => {
    const { dataset, rerender } = mount({ pageSize: 10 });
    rerender();
    expect(dataset.paging.setPageSize).toHaveBeenCalledTimes(1);
    expect(dataset.paging.setPageSize).toHaveBeenCalledWith(10);
    expect(dataset.paging.reset).toHaveBeenCalledTimes(1);
  });

  it("has a loading, an empty and a failed state, each with words", () => {
    const loading = mount({ records: [], loading: true });
    expect(within(loading.view.container).getByText(T("grid.loading"))).toBeTruthy();
    const empty = mount({ records: [] });
    expect(within(empty.view.container).getByText(T("grid.empty"))).toBeTruthy();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failed = mount({ error: true });
    expect(within(failed.view.container).getByRole("alert").textContent).toBe(T("grid.failed"));
    // Diagnostics name the failure, never the platform's message (it can name records).
    expect(warn).toHaveBeenCalledWith("[grid.load] Error");
  });

  it("becomes a list when the space is narrow", () => {
    mount({ width: 360 });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText(T("grid.labelValue", "City", "Utrecht"))).toBeTruthy();
  });

  it("speaks every configured language from its own RESX file", () => {
    for (const lcid of LANGUAGES) {
      const { view } = mount({ lcid, hasNextPage: true, total: 2 });
      const page = within(view.container);
      expect(page.getByRole("button", { name: expected("SampleGrid", "grid.next", [], lcid) })).toBeTruthy();
      expect(page.getByText(expectedCount("SampleGrid", "grid.count", 2, lcid))).toBeTruthy();
      expect(page.getByRole("checkbox", { name: expected("SampleGrid", "grid.select", ["Litware"], lcid) })).toBeTruthy();
      expect(view.container.textContent).not.toMatch(/\bgrid\.[a-z]/);
      view.unmount();
    }
  });
});
