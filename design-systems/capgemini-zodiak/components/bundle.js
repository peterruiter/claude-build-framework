/* @ds-bundle: {"format":4,"namespace":"CapgeminiZodiak","components":[{"name":"Button"},{"name":"Link"},{"name":"Tag"},{"name":"Card"},{"name":"Input"},{"name":"Select"},{"name":"Checkbox"},{"name":"Accordion"},{"name":"DataTable"}]} */
(function (global) {
  "use strict";

  var React = global.React;
  var h = React.createElement;
  var useState = React.useState;
  var useId = React.useId;

  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i]) out.push(arguments[i]);
    }
    return out.join(" ");
  }

  function omit(obj, keys) {
    var out = {};
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k) && keys.indexOf(k) === -1) out[k] = obj[k];
    }
    return out;
  }

  /* -- inline marks. Zodiak's icon font is not part of this system, so the two
        glyphs the components need are drawn here and inherit currentColor. -- */

  function ArrowRight(props) {
    return h(
      "svg",
      {
        width: props && props.size ? props.size : 16,
        height: props && props.size ? props.size : 16,
        viewBox: "0 0 16 16",
        fill: "none",
        "aria-hidden": "true",
        focusable: "false"
      },
      h("path", {
        d: "M2 8h11M9 4l4 4-4 4",
        stroke: "currentColor",
        strokeWidth: "1.5",
        strokeLinecap: "round",
        strokeLinejoin: "round"
      })
    );
  }

  function ChevronDown(props) {
    return h(
      "svg",
      {
        width: props && props.size ? props.size : 20,
        height: props && props.size ? props.size : 20,
        viewBox: "0 0 20 20",
        fill: "none",
        "aria-hidden": "true",
        focusable: "false"
      },
      h("path", {
        d: "M5 8l5 5 5-5",
        stroke: "currentColor",
        strokeWidth: "1.5",
        strokeLinecap: "round",
        strokeLinejoin: "round"
      })
    );
  }

  function CloseMark(props) {
    return h(
      "svg",
      {
        width: props && props.size ? props.size : 15,
        height: props && props.size ? props.size : 15,
        viewBox: "0 0 15 15",
        fill: "none",
        "aria-hidden": "true",
        focusable: "false"
      },
      h("path", {
        d: "M3.5 3.5l8 8M11.5 3.5l-8 8",
        stroke: "currentColor",
        strokeWidth: "1.5",
        strokeLinecap: "round"
      })
    );
  }

  /* ------------------------------------------------------------- Button */

  function Button(props) {
    var p = props || {};
    var variant = p.variant || "primary";
    var tone = p.tone || "lite";
    var size = p.size || "md";
    var rest = omit(p, ["variant", "tone", "size", "icon", "href", "children", "className"]);
    var cls = cx(
      "cgz-btn",
      "cgz-btn--" + variant,
      "cgz-btn--" + tone,
      size === "sm" ? "cgz-btn--sm" : null,
      p.className
    );
    var kids = [
      h("span", { key: "l" }, p.children),
      p.icon ? h("span", { className: "cgz-btn__icon", key: "i" }, h(ArrowRight, { size: size === "sm" ? 16 : 16 })) : null
    ];
    if (p.href) {
      return h("a", Object.assign({}, rest, { className: cls, href: p.href }), kids);
    }
    return h(
      "button",
      Object.assign({ type: "button" }, rest, { className: cls }),
      kids
    );
  }

  /* --------------------------------------------------------------- Link */

  function Link(props) {
    var p = props || {};
    var variant = p.variant || "default";
    var rest = omit(p, ["variant", "underline", "children", "className"]);
    return h(
      "a",
      Object.assign({}, rest, {
        className: cx(
          "cgz-link",
          variant !== "default" ? "cgz-link--" + variant : null,
          p.underline ? "cgz-link--underline" : null,
          p.className
        )
      }),
      p.children
    );
  }

  /* ---------------------------------------------------------------- Tag */

  function Tag(props) {
    var p = props || {};
    var rest = omit(p, ["onRemove", "removeLabel", "quiet", "children", "className"]);
    return h(
      "span",
      Object.assign({}, rest, {
        className: cx(
          "cgz-tag",
          p.quiet ? "cgz-tag--quiet" : null,
          p.onRemove ? "cgz-tag--removable" : null,
          p.className
        )
      }),
      h("span", { key: "t" }, p.children),
      p.onRemove
        ? h(
            "button",
            {
              key: "r",
              type: "button",
              className: "cgz-tag__remove",
              onClick: p.onRemove,
              "aria-label": p.removeLabel || "Remove"
            },
            h(CloseMark, null)
          )
        : null
    );
  }

  /* --------------------------------------------------------------- Card */

  function Card(props) {
    var p = props || {};
    var rest = omit(p, [
      "image", "imageAlt", "eyebrow", "eyebrowHref", "title", "href", "meta", "children", "footer", "className"
    ]);
    return h(
      "article",
      Object.assign({}, rest, { className: cx("cgz-card", p.className) }),
      p.image
        ? h(
            "div",
            { className: "cgz-card__media", key: "m" },
            h("img", { src: p.image, alt: p.imageAlt || "" })
          )
        : null,
      p.eyebrow
        ? h(
            "a",
            { className: "cgz-card__eyebrow", href: p.eyebrowHref || "#", key: "e" },
            p.eyebrow
          )
        : null,
      p.meta
        ? h(
            "span",
            { className: "cgz-card__meta", key: "d" },
            (Array.isArray(p.meta) ? p.meta : [p.meta]).map(function (v, i) {
              return h("span", { key: i }, v);
            })
          )
        : null,
      p.title
        ? h(
            "h3",
            { className: "cgz-card__title", key: "t" },
            p.href ? h("a", { href: p.href }, p.title) : p.title
          )
        : null,
      p.children ? h("p", { className: "cgz-card__body", key: "b" }, p.children) : null,
      p.footer ? h("div", { className: "cgz-card__footer", key: "f" }, p.footer) : null
    );
  }

  /* -------------------------------------------------------------- Input */

  function Field(p, control, id) {
    return h(
      "div",
      { className: cx("cgz-field", p.className) },
      p.label ? h("label", { className: "cgz-field__label", htmlFor: id, key: "l" }, p.label) : null,
      control,
      p.error
        ? h("span", { className: "cgz-field__error", id: id + "-msg", key: "e" }, p.error)
        : p.hint
        ? h("span", { className: "cgz-field__hint", id: id + "-msg", key: "h" }, p.hint)
        : null
    );
  }

  function Input(props) {
    var p = props || {};
    var auto = useId();
    var id = p.id || auto;
    var rest = omit(p, ["label", "hint", "error", "size", "className", "id"]);
    var control = h(
      "input",
      Object.assign({ type: "text" }, rest, {
        id: id,
        "aria-invalid": p.error ? "true" : undefined,
        "aria-describedby": p.error || p.hint ? id + "-msg" : undefined,
        className: cx("cgz-input", p.size === "lg" ? "cgz-input--lg" : null, p.error ? "cgz-input--invalid" : null)
      })
    );
    return Field(p, control, id);
  }

  /* ------------------------------------------------------------- Select */

  function Select(props) {
    var p = props || {};
    var auto = useId();
    var id = p.id || auto;
    var rest = omit(p, ["label", "hint", "error", "size", "options", "className", "id"]);
    var opts = (p.options || []).map(function (o, i) {
      var value = typeof o === "string" ? o : o.value;
      var label = typeof o === "string" ? o : o.label;
      return h("option", { key: i, value: value }, label);
    });
    var control = h(
      "div",
      { style: { position: "relative" } },
      h(
        "select",
        Object.assign({}, rest, {
          id: id,
          "aria-invalid": p.error ? "true" : undefined,
          "aria-describedby": p.error || p.hint ? id + "-msg" : undefined,
          className: cx("cgz-select", p.size === "lg" ? "cgz-select--lg" : null, p.error ? "cgz-select--invalid" : null)
        }),
        opts
      ),
      h(
        "span",
        {
          "aria-hidden": "true",
          style: {
            position: "absolute",
            right: "14px",
            top: "50%",
            transform: "translateY(-50%)",
            display: "inline-flex",
            color: "var(--text-primary)",
            pointerEvents: "none"
          }
        },
        h(ChevronDown, null)
      )
    );
    return Field(p, control, id);
  }

  /* ----------------------------------------------------------- Checkbox */

  function Checkbox(props) {
    var p = props || {};
    var auto = useId();
    var id = p.id || auto;
    var rest = omit(p, ["label", "className", "id"]);
    return h(
      "div",
      { className: cx("cgz-check", p.className) },
      h("input", Object.assign({ type: "checkbox" }, rest, { id: id, className: "cgz-check__input" })),
      h(
        "label",
        { className: "cgz-check__label", htmlFor: id },
        h("span", { className: "cgz-check__box", "aria-hidden": "true" }),
        h("span", null, p.label)
      )
    );
  }

  /* ---------------------------------------------------------- Accordion */

  function Accordion(props) {
    var p = props || {};
    var items = p.items || [];
    var initial = typeof p.defaultOpen === "number" ? p.defaultOpen : -1;
    var state = useState(initial);
    var open = state[0];
    var setOpen = state[1];
    var base = useId();
    return h(
      "div",
      { className: cx("cgz-accordion", p.className) },
      items.map(function (item, i) {
        var isOpen = open === i;
        var panelId = base + "-p" + i;
        var titleId = base + "-t" + i;
        return h(
          "div",
          { key: i, className: cx("cgz-accordion__item", isOpen ? "cgz-accordion__item--open" : null) },
          h(
            "button",
            {
              type: "button",
              id: titleId,
              className: "cgz-accordion__title",
              "aria-expanded": isOpen ? "true" : "false",
              "aria-controls": panelId,
              onClick: function () {
                setOpen(open === i ? -1 : i);
              }
            },
            h("span", { className: "cgz-accordion__chevron" }, h(ChevronDown, null)),
            h("span", null, item.title)
          ),
          isOpen
            ? h(
                "div",
                { id: panelId, role: "region", "aria-labelledby": titleId, className: "cgz-accordion__content" },
                item.content
              )
            : null
        );
      })
    );
  }

  /* ---------------------------------------------------------- DataTable */

  function DataTable(props) {
    var p = props || {};
    var columns = p.columns || [];
    var rows = p.rows || [];
    return h(
      "div",
      { className: cx("cgz-table", p.className), role: "table", "aria-label": p.caption },
      h(
        "div",
        { className: "cgz-table__head", role: "row" },
        columns.map(function (c, i) {
          return h(
            "div",
            { key: i, className: "cgz-table__th", role: "columnheader" },
            typeof c === "string" ? c : c.header
          );
        })
      ),
      rows.map(function (row, ri) {
        return h(
          "div",
          { key: ri, className: "cgz-table__row", role: "row" },
          columns.map(function (c, ci) {
            var key = typeof c === "string" ? c : c.key;
            return h("div", { key: ci, className: "cgz-table__td", role: "cell" }, row[key]);
          })
        );
      })
    );
  }

  global.CapgeminiZodiak = {
    Button: Button,
    Link: Link,
    Tag: Tag,
    Card: Card,
    Input: Input,
    Select: Select,
    Checkbox: Checkbox,
    Accordion: Accordion,
    DataTable: DataTable
  };
})(window);
