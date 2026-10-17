import * as React from "react";
import {
  Button,
  Checkbox,
  FluentProvider,
  Link,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  TableSelectionCell,
  Text,
  makeStyles,
  tokens,
  useArrowNavigationGroup,
  type Theme,
} from "@fluentui/react-components";
import type { Strings } from "../../shared/strings";

export interface GridColumn {
  name: string;
  label: string;
  sort?: "ascending" | "descending";
}

export interface GridRow {
  id: string;
  cells: Record<string, string>;
  selected: boolean;
}

export interface SampleGridViewProps {
  title: string;
  columns: GridColumn[];
  primaryColumn: string;
  rows: GridRow[];
  loading: boolean;
  failed: boolean;
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  /** Total records for the view, or -1 when the host does not know (canvas, large views). */
  total: number;
  /** Less than 480 px allocated: a list instead of a table. */
  compact: boolean;
  strings: Strings;
  theme: Theme;
  dir: "ltr" | "rtl";
  onOpen: (id: string) => void;
  onSelect: (ids: string[]) => void;
  onSort: (column: string) => void;
  onPage: (delta: 1 | -1) => void;
}

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    rowGap: tokens.spacingVerticalS,
    width: "100%",
    backgroundColor: "transparent",
  },
  scroller: { overflowX: "auto" },
  footer: { display: "flex", alignItems: "center", columnGap: tokens.spacingHorizontalS, flexWrap: "wrap" },
  status: { display: "flex", columnGap: tokens.spacingHorizontalM, color: tokens.colorNeutralForeground2 },
  list: {
    listStyleType: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
  },
  item: {
    display: "flex",
    flexDirection: "column",
    rowGap: tokens.spacingVerticalXXS,
    paddingBlock: tokens.spacingVerticalS,
    paddingInline: tokens.spacingHorizontalS,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  secondary: { color: tokens.colorNeutralForeground2 },
});

export const SampleGridView = React.memo(function SampleGridView(props: SampleGridViewProps) {
  const { title, columns, primaryColumn, rows, loading, failed, page, hasPrevious, hasNext, total, compact, strings, theme, dir } =
    props;
  const styles = useStyles();
  // Arrow keys move between cells; Tab leaves the table (WAI-ARIA grid pattern via Fluent's tabster).
  const navigation = useArrowNavigationGroup({ axis: "grid" });

  const name = (row: GridRow): string => row.cells[primaryColumn] || strings.text("grid.untitled");
  const toggle = (row: GridRow): void =>
    props.onSelect(rows.filter((one) => (one.id === row.id ? !one.selected : one.selected)).map((one) => one.id));
  const allSelected = rows.length > 0 && rows.every((row) => row.selected);
  const someSelected = rows.some((row) => row.selected);

  let body: React.ReactNode;
  if (failed) {
    body = <Text role="alert">{strings.text("grid.failed")}</Text>;
  } else if (loading && rows.length === 0) {
    body = <Spinner size="small" label={strings.text("grid.loading")} />;
  } else if (rows.length === 0) {
    body = <Text>{strings.text("grid.empty")}</Text>;
  } else if (compact) {
    body = (
      <ul className={styles.list} aria-label={title}>
        {rows.map((row) => (
          <li key={row.id} className={styles.item}>
            <Checkbox checked={row.selected} label={strings.text("grid.select", name(row))} onChange={() => toggle(row)} />
            <Link as="button" onClick={() => props.onOpen(row.id)}>
              {name(row)}
            </Link>
            {columns
              .filter((column) => column.name !== primaryColumn && row.cells[column.name])
              .map((column) => (
                <Text key={column.name} size={200} className={styles.secondary}>
                  {strings.text("grid.labelValue", column.label, row.cells[column.name])}
                </Text>
              ))}
          </li>
        ))}
      </ul>
    );
  } else {
    body = (
      <div className={styles.scroller}>
        <Table aria-label={title} aria-busy={loading} {...navigation}>
          <TableHeader>
            <TableRow>
              <TableSelectionCell
                checked={allSelected ? true : someSelected ? "mixed" : false}
                checkboxIndicator={{ "aria-label": strings.text("grid.selectAll") }}
                onClick={() => props.onSelect(allSelected ? [] : rows.map((row) => row.id))}
              />
              {columns.map((column) => (
                <TableHeaderCell
                  key={column.name}
                  sortable
                  sortDirection={column.sort}
                  onClick={() => props.onSort(column.name)}
                >
                  {column.label}
                </TableHeaderCell>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} aria-selected={row.selected}>
                <TableSelectionCell
                  checked={row.selected}
                  checkboxIndicator={{ "aria-label": strings.text("grid.select", name(row)) }}
                  onClick={() => toggle(row)}
                />
                {columns.map((column) => (
                  <TableCell key={column.name}>
                    {column.name === primaryColumn ? (
                      <Link as="button" onClick={() => props.onOpen(row.id)}>
                        {name(row)}
                      </Link>
                    ) : (
                      row.cells[column.name]
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <FluentProvider theme={theme} dir={dir} className={styles.root}>
      {body}
      <div className={styles.footer}>
        <Button disabled={!hasPrevious || loading} onClick={() => props.onPage(-1)}>
          {strings.text("grid.previous")}
        </Button>
        <Button disabled={!hasNext || loading} onClick={() => props.onPage(1)}>
          {strings.text("grid.next")}
        </Button>
        <div className={styles.status} aria-live="polite">
          <Text>{strings.text("grid.page", page)}</Text>
          {total >= 0 && <Text>{strings.counted("grid.count", total)}</Text>}
        </div>
      </div>
    </FluentProvider>
  );
});
