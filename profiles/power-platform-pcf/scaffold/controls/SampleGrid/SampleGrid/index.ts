import * as React from "react";
import { reportError } from "../../shared/diagnostics";
import { createStrings } from "../../shared/strings";
import { hostDirection, hostTheme } from "../../shared/theme";
import type { IInputs, IOutputs } from "./generated/ManifestTypes";
import { SampleGridView, type GridColumn, type GridRow, type SampleGridViewProps } from "./SampleGridView";
import { FALLBACK } from "./strings/fallback.generated";

type DataSet = ComponentFramework.PropertyTypes.DataSet;
type Column = ComponentFramework.PropertyHelper.DataSetApi.Column;

const ASCENDING = 0;
const DESCENDING = 1;

/**
 * A dataset control (virtual). The platform owns the data: the control asks for sorting and
 * pages through the dataset API and renders what updateView receives. Paging uses
 * loadExactPage with the page number kept here, which behaves the same in model-driven and
 * canvas apps; only one paging call may run at a time, so nothing pages while loading.
 */
export class SampleGrid implements ComponentFramework.ReactControl<IInputs, IOutputs> {
  private page = 1;
  private pageSizeApplied = false;

  public init(context: ComponentFramework.Context<IInputs>): void {
    context.mode.trackContainerResize(true);
  }

  public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
    const dataset = context.parameters.records;
    const strings = createStrings((key) => context.resources.getString(key), context.userSettings.languageId, FALLBACK);
    this.applyPageSize(dataset, context.parameters.pageSize.raw);

    const columns = visibleColumns(dataset);
    const primary = columns.find((column) => column.isPrimary)?.name ?? columns[0]?.name ?? "";
    const selected = new Set(dataset.getSelectedRecordIds());
    const rows: GridRow[] = dataset.sortedRecordIds.map((id) => {
      const record = dataset.records[id];
      const cells: Record<string, string> = {};
      for (const column of columns) cells[column.name] = record.getFormattedValue(column.name) ?? "";
      return { id, cells, selected: selected.has(id) };
    });
    // The platform's message can name records or columns: report that it failed, not why.
    if (dataset.error) reportError("grid.load", new Error("dataset"));

    const props: SampleGridViewProps = {
      title: dataset.getTitle() || strings.text("grid.label"),
      columns: columns.map((column): GridColumn => ({
        name: column.name,
        label: column.displayName,
        sort: sortOf(dataset, column.name),
      })),
      primaryColumn: primary,
      rows,
      loading: dataset.loading,
      failed: dataset.error,
      page: this.page,
      hasPrevious: dataset.paging.hasPreviousPage,
      hasNext: dataset.paging.hasNextPage,
      total: dataset.paging.totalResultCount,
      compact: context.mode.allocatedWidth > 0 && context.mode.allocatedWidth < 480,
      strings,
      theme: hostTheme(context),
      dir: hostDirection(context),
      onOpen: (id) => dataset.openDatasetItem(dataset.records[id].getNamedReference()),
      onSelect: (ids) => dataset.setSelectedRecordIds(ids),
      onSort: (name) => {
        if (dataset.loading) return;
        const next = sortOf(dataset, name) === "ascending" ? DESCENDING : ASCENDING;
        while (dataset.sorting.length > 0) dataset.sorting.pop();
        dataset.sorting.push({ name, sortDirection: next });
        this.page = 1;
        dataset.refresh();
      },
      onPage: (delta) => {
        if (dataset.loading) return;
        const target = this.page + delta;
        if (target < 1) return;
        this.page = target;
        dataset.paging.loadExactPage(target);
      },
    };
    return React.createElement(SampleGridView, props);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    // Nothing is held outside React.
  }

  /** The page size from the property, once; applying a new size reloads page 1. */
  private applyPageSize(dataset: DataSet, wanted: number | null): void {
    if (this.pageSizeApplied) return;
    this.pageSizeApplied = true;
    const size = Math.min(250, Math.max(1, wanted ?? 25));
    if (dataset.paging.pageSize === size) return;
    dataset.paging.setPageSize(size);
    if (!dataset.loading) dataset.paging.reset();
  }
}

function visibleColumns(dataset: DataSet): Column[] {
  return dataset.columns
    .filter((column) => !column.isHidden && column.order >= 0)
    .sort((a, b) => a.order - b.order);
}

function sortOf(dataset: DataSet, name: string): GridColumn["sort"] {
  const status = dataset.sorting.find((one) => one.name === name);
  if (!status) return undefined;
  return status.sortDirection === DESCENDING ? "descending" : "ascending";
}
