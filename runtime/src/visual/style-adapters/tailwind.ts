/**
 * fe-sight — Tailwind Adapter
 *
 * Maps CSS property values to Tailwind utility classes.
 * Provides suggestions for fixing style mismatches using Tailwind.
 */

// ─── Font Size ───────────────────────────────────────────────

const FONT_SIZE_MAP: Record<number, string> = {
  12: "text-xs",
  13: "text-sm",
  14: "text-sm",
  16: "text-base",
  18: "text-lg",
  20: "text-xl",
  24: "text-2xl",
  30: "text-3xl",
  36: "text-4xl",
  40: "text-5xl",
  48: "text-5xl",
  60: "text-6xl",
  72: "text-7xl",
  96: "text-8xl",
  128: "text-9xl",
};

// ─── Color (approximate Tailwind gray scale) ─────────────────

const COLOR_MAP: Record<string, string> = {
  "#ffffff": "text-white",
  "#000000": "text-black",
  "#1a1a1a": "text-gray-900",
  "#111827": "text-gray-900",
  "#1f2937": "text-gray-800",
  "#374151": "text-gray-700",
  "#4b5563": "text-gray-600",
  "#6b7280": "text-gray-500",
  "#9ca3af": "text-gray-400",
  "#d1d5db": "text-gray-300",
  "#e5e7eb": "text-gray-200",
  "#f3f4f6": "text-gray-100",
  "#f9fafb": "text-gray-50",
};

const BG_COLOR_MAP: Record<string, string> = {
  "#ffffff": "bg-white",
  "#000000": "bg-black",
  "#111827": "bg-gray-900",
  "#1f2937": "bg-gray-800",
  "#374151": "bg-gray-700",
  "#4b5563": "bg-gray-600",
  "#6b7280": "bg-gray-500",
  "#9ca3af": "bg-gray-400",
  "#d1d5db": "bg-gray-300",
  "#e5e7eb": "bg-gray-200",
  "#f3f4f6": "bg-gray-100",
  "#f9fafb": "bg-gray-50",
};

const BORDER_COLOR_MAP: Record<string, string> = {
  "#e5e7eb": "border-gray-200",
  "#d1d5db": "border-gray-300",
  "#9ca3af": "border-gray-400",
  "#6b7280": "border-gray-500",
  "#374151": "border-gray-600",
  "#1f2937": "border-gray-700",
};

// ─── Border Radius ───────────────────────────────────────────

const RADIUS_MAP: Record<number, string> = {
  0: "rounded-none",
  2: "rounded-sm",
  4: "rounded",
  6: "rounded-md",
  8: "rounded-md",
  12: "rounded-lg",
  16: "rounded-xl",
  24: "rounded-2xl",
  9999: "rounded-full",
};

// ─── Padding / Margin / Gap (spacing) ────────────────────────

const SPACING_MAP: Record<number, string> = {
  0: "p-0", 1: "p-0.5", 2: "p-0.5", 4: "p-1", 6: "p-1.5",
  8: "p-2", 10: "p-2.5", 12: "p-3", 14: "p-3.5",
  16: "p-4", 20: "p-5", 24: "p-6", 28: "p-7",
  32: "p-8", 36: "p-9", 40: "p-10", 44: "p-11",
  48: "p-12", 56: "p-14", 64: "p-16",
};

// ─── Font Weight ─────────────────────────────────────────────

const FONT_WEIGHT_MAP: Record<string, string> = {
  "100": "font-thin", "200": "font-extralight", "300": "font-light",
  "400": "font-normal", "500": "font-medium", "600": "font-semibold",
  "700": "font-bold", "800": "font-extrabold", "900": "font-black",
};

// ─── Text Align ──────────────────────────────────────────────

const TEXT_ALIGN_MAP: Record<string, string> = {
  left: "text-left", center: "text-center", right: "text-right", justify: "text-justify",
};

// ─── Grid ────────────────────────────────────────────────────

function gridColumnsToClass(value: string): string | null {
  const repeat = value.match(/repeat\((\d+)/);
  if (repeat) return `grid-cols-${repeat[1]}`;
  return null;
}

function gridRowsToClass(value: string): string | null {
  const repeat = value.match(/repeat\((\d+)/);
  if (repeat) return `grid-rows-${repeat[1]}`;
  return null;
}

// ─── Display ─────────────────────────────────────────────────

const DISPLAY_MAP: Record<string, string> = {
  flex: "flex", grid: "grid", block: "block", hidden: "hidden",
  "inline-flex": "inline-flex", "inline-grid": "inline-grid",
  "inline-block": "inline-block", "inline": "inline",
};

// ─── Public API ─────────────────────────────────────────────

export function cssToTailwind(property: string, value: string): string | null {
  const numValue = parseFloat(value);

  switch (property) {
    case "font-size":
      return closestInMap(numValue, FONT_SIZE_MAP);
    case "font-weight":
      return FONT_WEIGHT_MAP[value] ?? null;
    case "color":
      return COLOR_MAP[value.toLowerCase()] ?? null;
    case "background-color":
      return BG_COLOR_MAP[value.toLowerCase()] ?? null;
    case "border-color":
      return BORDER_COLOR_MAP[value.toLowerCase()] ?? null;
    case "border-radius":
      return closestInMap(numValue, RADIUS_MAP);
    case "padding":
      return closestInMap(numValue, SPACING_MAP);
    case "margin":
      return closestInMap(numValue, SPACING_MAP)?.replace("p-", "m-") ?? null;
    case "gap":
      return closestInMap(numValue, SPACING_MAP)?.replace("p-", "gap-") ?? null;
    case "text-align":
      return TEXT_ALIGN_MAP[value.toLowerCase()] ?? null;
    case "display":
      return DISPLAY_MAP[value.toLowerCase()] ?? null;
    case "grid-template-columns":
      return gridColumnsToClass(value);
    case "grid-template-rows":
      return gridRowsToClass(value);
    default:
      return null;
  }
}

export function suggestTailwindFix(
  property: string,
  designValue: string,
  actualValue: string,
): { oldClass: string; newClass: string } | null {
  const designClass = cssToTailwind(property, designValue);
  const actualClass = cssToTailwind(property, actualValue);

  if (!designClass && !actualClass) return null;

  return {
    oldClass: actualClass ?? `${property}: ${actualValue}`,
    newClass: designClass ?? `${property}: ${designValue}`,
  };
}

function closestInMap(value: number, map: Record<number, string>): string | null {
  if (isNaN(value)) return null;

  const keys = Object.keys(map).map(Number).sort((a, b) => a - b);
  let closest = keys[0];
  let minDiff = Math.abs(value - closest);

  for (const k of keys) {
    const diff = Math.abs(value - k);
    if (diff < minDiff) {
      minDiff = diff;
      closest = k;
    }
  }

  return map[closest] ?? null;
}
