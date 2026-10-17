import * as React from "react";
import {
  Button,
  FluentProvider,
  Input,
  Text,
  makeStyles,
  tokens,
  useId,
  type Theme,
} from "@fluentui/react-components";
import type { Strings } from "../../shared/strings";

export interface SampleFieldProps {
  value: string;
  /** The column's display name: the input's accessible name (the form shows it as the label). */
  label: string;
  maxLength?: number;
  hidden: boolean;
  disabled: boolean;
  showCounter: boolean;
  /** Less than 320 px allocated: the clear button goes under the input. */
  narrow: boolean;
  strings: Strings;
  theme: Theme;
  dir: "ltr" | "rtl";
  /** Called when the reader leaves the input, presses Enter, or clears it. */
  onCommit: (value: string) => void;
}

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    rowGap: tokens.spacingVerticalXS,
    width: "100%",
    backgroundColor: "transparent",
  },
  row: { display: "flex", alignItems: "center", columnGap: tokens.spacingHorizontalS },
  stacked: { flexDirection: "column", alignItems: "stretch", rowGap: tokens.spacingVerticalXS },
  input: { flexGrow: 1, minWidth: 0 },
  counter: { color: tokens.colorNeutralForeground2 },
  hidden: { color: tokens.colorNeutralForeground2, fontStyle: "italic" },
});

export const SampleField = React.memo(function SampleField(props: SampleFieldProps) {
  const { value, label, maxLength, hidden, disabled, showCounter, narrow, strings, theme, dir, onCommit } = props;
  const styles = useStyles();
  const counterId = useId("counter");
  const [draft, setDraft] = React.useState(value);

  // A new value from the platform (another user's save, a business rule) replaces the draft.
  React.useEffect(() => setDraft(value), [value]);

  const counter = maxLength !== undefined
    ? strings.counted("field.remaining", Math.max(0, maxLength - draft.length))
    : strings.counted("field.counter", draft.length);

  return (
    <FluentProvider theme={theme} dir={dir} className={styles.root}>
      {hidden ? (
        <Text className={styles.hidden}>{strings.text("field.hidden")}</Text>
      ) : (
        <>
          <div className={narrow ? `${styles.row} ${styles.stacked}` : styles.row}>
            <Input
              className={styles.input}
              value={draft}
              maxLength={maxLength}
              disabled={disabled}
              aria-label={label}
              aria-describedby={showCounter ? counterId : undefined}
              onChange={(_, data) => setDraft(data.value)}
              onBlur={() => onCommit(draft)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onCommit(draft);
              }}
            />
            <Button
              appearance="secondary"
              disabled={disabled || draft === ""}
              aria-label={strings.text("field.clearLabel", label)}
              onClick={() => {
                setDraft("");
                onCommit("");
              }}
            >
              {strings.text("field.clear")}
            </Button>
          </div>
          {showCounter && (
            <Text id={counterId} size={200} className={styles.counter}>
              {counter}
            </Text>
          )}
        </>
      )}
    </FluentProvider>
  );
});
