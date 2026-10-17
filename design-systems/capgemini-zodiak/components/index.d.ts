/**
 * Capgemini Zodiak components.
 *
 * The bundle is a classic script that assigns `window.CapgeminiZodiak`.
 * It reads `window.React`; load React 18 and ReactDOM 18 before it.
 *
 * Every component paints with semantic tokens only, so it follows the theme
 * set by `data-theme` on the root element.
 */

import type * as React from "react";

/** Which action token family the control paints with. Zodiak gives both the
 *  same values today; the split exists so they can diverge. */
export type Variant = "primary" | "secondary";

/** The ground the control sits on, not the theme. `lite` for page-background
 *  and the lite surfaces, `heavy` for surface-ink-heavy, surface-marine-heavy,
 *  surface-azur-heavy and surface-always-black. */
export type Tone = "lite" | "heavy";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Default `"primary"`. */
  variant?: Variant;
  /** Default `"lite"`. */
  tone?: Tone;
  /** `"md"` is 48px tall, `"sm"` is 38px. Default `"md"`. */
  size?: "md" | "sm";
  /** Adds the trailing arrow. Use it when the button navigates. */
  icon?: boolean;
  /** Renders an anchor instead of a button. */
  href?: string;
  children?: React.ReactNode;
}
export declare function Button(props: ButtonProps): React.ReactElement;

export interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /** `"default"` sweeps border-secondary, `"highlight"` sweeps the peacock
   *  highlight, `"inverse"` is for the heavy blue surfaces. Default `"default"`. */
  variant?: "default" | "highlight" | "inverse";
  /** Adds a persistent underline. Set it for links inside running copy:
   *  text-link and text-primary are close in value, so colour alone does not
   *  mark the link. */
  underline?: boolean;
  children?: React.ReactNode;
}
export declare function Link(props: LinkProps): React.ReactElement;

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Shows the remove control and calls this on click. */
  onRemove?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** Accessible name for the remove control. Default `"Remove"`. */
  removeLabel?: string;
  /** Outline instead of the filled text-link pill. Use for read-only labels. */
  quiet?: boolean;
  children?: React.ReactNode;
}
export declare function Tag(props: TagProps): React.ReactElement;

export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  /** Image URL. The card scales it 1.1x on hover. */
  image?: string;
  /** Alt text. Pass `""` when the image is decorative. */
  imageAlt?: string;
  /** Category label above the title. Gets the turquoise sweep on hover. */
  eyebrow?: React.ReactNode;
  eyebrowHref?: string;
  title?: React.ReactNode;
  /** Wraps the title in a link and sweeps it on card hover. */
  href?: string;
  /** One string, or several joined by the dot separator. */
  meta?: React.ReactNode | React.ReactNode[];
  /** Body copy. */
  children?: React.ReactNode;
  /** Footer slot, usually a Button or Link. */
  footer?: React.ReactNode;
}
export declare function Card(props: CardProps): React.ReactElement;

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  /** Helper text under the field. Hidden while `error` is set. */
  hint?: React.ReactNode;
  /** Error text. Also sets aria-invalid and the negative border. */
  error?: React.ReactNode;
  /** `"md"` is 48px tall, `"lg"` is 58px. Default `"md"`. */
  size?: "md" | "lg";
}
export declare function Input(props: InputProps): React.ReactElement;

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  size?: "md" | "lg";
  /** Strings, or `{ value, label }` pairs. */
  options?: Array<string | { value: string; label: string }>;
}
export declare function Select(props: SelectProps): React.ReactElement;

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
}
export declare function Checkbox(props: CheckboxProps): React.ReactElement;

export interface AccordionItem {
  title: React.ReactNode;
  content: React.ReactNode;
}
export interface AccordionProps {
  items: AccordionItem[];
  /** Index open on first render. Omit to start closed. */
  defaultOpen?: number;
  className?: string;
}
export declare function Accordion(props: AccordionProps): React.ReactElement;

export interface DataTableColumn {
  key: string;
  header: React.ReactNode;
}
export interface DataTableProps {
  /** Column keys map to keys on each row. */
  columns: DataTableColumn[];
  rows: Array<Record<string, React.ReactNode>>;
  /** Accessible name for the table. */
  caption?: string;
  className?: string;
}
export declare function DataTable(props: DataTableProps): React.ReactElement;
