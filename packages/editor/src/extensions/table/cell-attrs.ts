import { TableCell, TableHeader } from "@tiptap/extension-table";

/**
 * Cell background colours (T4.2). The document stores a palette **code**, never a colour value:
 * the web app maps each code to theme tokens that work in light and dark mode
 * (`[data-background-color="<code>"]` in `apps/web/src/components/editor/editor.css`), and the
 * UI labels it through `table.colors.<code>`. Never rename or remove a code — it is stored in
 * Yjs documents; add new ones at the end.
 */
export const CELL_BACKGROUND_COLORS = [
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
] as const;
export type CellBackgroundColor = (typeof CELL_BACKGROUND_COLORS)[number];

/** Name of the cell attribute (used by the paste parser's `backgroundAttr`). */
export const CELL_BACKGROUND_ATTR = "backgroundColor";

/** HTML attribute carrying the code in rendered HTML (copy/paste, static rendering). */
export const CELL_BACKGROUND_DATA_ATTR = "data-background-color";

export function isCellBackgroundColor(value: unknown): value is CellBackgroundColor {
  return typeof value === "string" && (CELL_BACKGROUND_COLORS as readonly string[]).includes(value);
}

/**
 * Reference RGB of each code — only to map a foreign colour (Excel, Google Sheets, a web page)
 * to the nearest palette entry. Never rendered: the UI uses theme tokens.
 */
const REFERENCE_RGB: Record<CellBackgroundColor, readonly [number, number, number]> = {
  gray: [128, 128, 128],
  red: [230, 60, 60],
  orange: [245, 150, 40],
  yellow: [250, 225, 50],
  green: [60, 175, 80],
  blue: [60, 130, 230],
  purple: [140, 80, 200],
  pink: [235, 100, 170],
};

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl([r, g, b]: readonly [number, number, number]): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

/**
 * Nearest palette code for a `#rrggbb` colour (T4.4b: `mapBackground` of the paste parser), by
 * hue — pastel fills such as Excel's `#FFF2CC` map to their hue, not to gray. Near-white,
 * near-black and low-saturation colours map to `gray`; white is handled by the parser (no fill).
 * Returns `null` for anything that is not a 6-digit hex colour.
 */
export function nearestCellBackgroundColor(hex: string): CellBackgroundColor | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [h, s, l] = rgbToHsl(rgb);
  if (s < 0.15 || l > 0.97 || l < 0.08) return "gray";
  let best: CellBackgroundColor = "gray";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const code of CELL_BACKGROUND_COLORS) {
    if (code === "gray") continue;
    const [ch] = rgbToHsl(REFERENCE_RGB[code]);
    const diff = Math.abs(h - ch);
    const distance = Math.min(diff, 360 - diff);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = code;
    }
  }
  return best;
}

/**
 * `backgroundColor` attribute: a palette code or `null`. Rendered as `data-background-color`;
 * parsed back from it, so the colour survives internal copy/paste and `getHTML`/`setContent`.
 * Unknown codes are dropped (null). Plain HTML with an inline `background-color` (or `bgcolor`)
 * maps to the nearest palette code.
 */
const backgroundColorAttribute = {
  [CELL_BACKGROUND_ATTR]: {
    default: null,
    parseHTML: (element: HTMLElement): CellBackgroundColor | null => {
      const code = element.getAttribute(CELL_BACKGROUND_DATA_ATTR);
      if (code !== null) return isCellBackgroundColor(code) ? code : null;
      const raw = element.style?.backgroundColor || element.getAttribute("bgcolor") || "";
      const hex = cssColorToHex(raw);
      return hex ? nearestCellBackgroundColor(hex) : null;
    },
    renderHTML: (attributes: Record<string, unknown>) => {
      const code = attributes[CELL_BACKGROUND_ATTR];
      return isCellBackgroundColor(code) ? { [CELL_BACKGROUND_DATA_ATTR]: code } : {};
    },
  },
};

/** `#rgb`, `#rrggbb` or `rgb(r, g, b)` → `#rrggbb`; white / transparent / other → `null`. */
function cssColorToHex(value: string): string | null {
  const v = value.trim().toLowerCase();
  let m: RegExpExecArray | null;
  let hex: string | null = null;
  if ((m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v))) {
    hex = `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`;
  } else if ((m = /^#([0-9a-f]{6})$/.exec(v))) {
    hex = `#${m[1]}`;
  } else if ((m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v))) {
    if (m[4] !== undefined && Number.parseFloat(m[4]) === 0) return null;
    hex = `#${[m[1], m[2], m[3]]
      .map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0"))
      .join("")}`;
  }
  return hex && hex !== "#ffffff" ? hex : null;
}

/** `tableCell` with the `backgroundColor` attribute. Merge/split come from prosemirror-tables. */
export const TableCellWithAttrs = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...backgroundColorAttribute };
  },
});

/** `tableHeader` with the `backgroundColor` attribute. */
export const TableHeaderWithAttrs = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...backgroundColorAttribute };
  },
});
