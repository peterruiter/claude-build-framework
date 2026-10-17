import * as React from "react";
import { createStrings } from "../../shared/strings";
import { hostDirection, hostTheme } from "../../shared/theme";
import type { IInputs, IOutputs } from "./generated/ManifestTypes";
import { SampleField, type SampleFieldProps } from "./SampleField";
import { FALLBACK } from "./strings/fallback.generated";

/**
 * A field control (virtual): React renders it inside the platform's React tree, with the
 * platform's Fluent v9 and theme. The column value comes in through updateView and goes out
 * through getOutputs after notifyOutputChanged; the control never touches the form directly.
 */
export class SampleControl implements ComponentFramework.ReactControl<IInputs, IOutputs> {
  private notifyOutputChanged: () => void = () => undefined;
  private value: string | undefined;

  public init(context: ComponentFramework.Context<IInputs>, notifyOutputChanged: () => void): void {
    this.notifyOutputChanged = notifyOutputChanged;
    this.value = context.parameters.value.raw ?? undefined;
    // Ask for allocatedWidth/allocatedHeight in updateView, so the layout follows the space the
    // form or screen gives the control rather than the window.
    context.mode.trackContainerResize(true);
  }

  public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
    const parameter = context.parameters.value;
    this.value = parameter.raw ?? undefined;
    const strings = createStrings((key) => context.resources.getString(key), context.userSettings.languageId, FALLBACK);

    const props: SampleFieldProps = {
      value: parameter.raw ?? "",
      // An empty display name (a canvas app property) falls back to the control's own word: || on purpose.
      label: parameter.attributes?.DisplayName || strings.text("Value_Name"),
      maxLength: positive(parameter.attributes?.MaxLength),
      // Field security: hide what the user may not read; lock what they may not change.
      hidden: parameter.security?.readable === false,
      disabled: context.mode.isControlDisabled || parameter.security?.editable === false,
      showCounter: context.parameters.showCounter.raw !== false,
      narrow: context.mode.allocatedWidth > 0 && context.mode.allocatedWidth < 320,
      strings,
      theme: hostTheme(context),
      dir: hostDirection(context),
      onCommit: (next) => {
        const normalised = next === "" ? undefined : next;
        if (normalised === this.value) return;
        this.value = normalised;
        this.notifyOutputChanged();
      },
    };
    return React.createElement(SampleField, props);
  }

  public getOutputs(): IOutputs {
    return { value: this.value };
  }

  public destroy(): void {
    // Nothing is held outside React: no listeners, timers or connections to clean up.
  }
}

function positive(value: number | undefined): number | undefined {
  return typeof value === "number" && value > 0 ? value : undefined;
}
