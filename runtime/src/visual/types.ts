/**
 * fe-sight — Shared Types
 *
 * Core data types for the visual fidelity engine.
 */

// ─── Design (Figma / Image) ──────────────────────────────────

export interface DesignElement {
  id: string;
  type: "text" | "rectangle" | "image" | "button" | "input" | "group" | "frame";
  text?: string;
  rect: { x: number; y: number; width: number; height: number };
  style?: Partial<CssStyles>;
  children?: DesignElement[];
}

export interface DesignSnapshot {
  elements: DesignElement[];
  width: number;
  height: number;
  source: "figma" | "image";
}

// ─── Rendered (Browser DOM) ──────────────────────────────────

export interface RenderedElement {
  tag: string;
  text?: string;
  rect: { x: number; y: number; width: number; height: number };
  styles: Partial<CssStyles>;
  attributes: Record<string, string>;
  children?: RenderedElement[];
}

export interface RenderedSnapshot {
  elements: RenderedElement[];
  screenshot: Buffer;
  width: number;
  height: number;
}

// ─── CSS Properties We Compare ───────────────────────────────

export interface CssStyles {
  "font-size": string;
  "font-weight": string;
  "font-family": string;
  "line-height": string;
  "letter-spacing": string;
  color: string;
  "background-color": string;
  "border-color": string;
  padding: string;
  margin: string;
  "border-width": string;
  "border-radius": string;
  width: string;
  height: string;
  display: string;
  "flex-direction": string;
  "align-items": string;
  "justify-content": string;
  "box-shadow": string;
  opacity: string;
  gap: string;
  "text-align": string;
  position: string;
  "min-height": string;
  "grid-template-columns": string;
  "grid-template-rows": string;
}

// ─── Element Matching ────────────────────────────────────────

export type MatchMethod = "text" | "position" | "structure";

export interface ElementMatch {
  designId: string;
  renderedIndex: number;
  confidence: number;
  method: MatchMethod;
}

// ─── Style Diff ──────────────────────────────────────────────

export type Severity = "critical" | "major" | "minor";

export interface StyleDiff {
  property: string;
  designValue: string;
  actualValue: string;
  severity: Severity;
  suggestion: string;
  suggestionType: "tailwind" | "token" | "css";
}

// ─── Project Info ────────────────────────────────────────────

export interface ProjectInfo {
  platform: "web" | "h5" | "flutter" | "rn";
  styleSystem: "tailwind" | "tokens" | "css" | "unknown";
  hasTailwind: boolean;
  hasTokens: boolean;
  framework?: "react" | "vue" | "svelte" | "next" | "nuxt" | "unknown";
}

// ─── Report ──────────────────────────────────────────────────

export interface FidelityReport {
  score: number;
  platform: string;
  styleSystem: string;
  elementCount: number;
  matchedElements: number;
  styleDiffs: StyleDiff[];
  pixelDiffPct: number;
  summary: string;
}

// ─── Figma / MasterGo API Types ─────────────────────────────

export interface FigmaFile {
  key: string;
  name: string;
  document: FigmaNode;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  children?: FigmaNode[];
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  effects?: FigmaEffect[];
  strokeWeight?: number;
  cornerRadius?: number;
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  layoutGrids?: Array<{ pattern: string; sectionSize?: number }>;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  style?: FigmaStyle;
  characters?: string;
  styleId?: string;
}

export interface FigmaPaint {
  type: "SOLID" | "GRADIENT_LINEAR" | "GRADIENT_RADIAL" | "IMAGE" | "EMOJI";
  color?: { r: number; g: number; b: number; a?: number };
  opacity?: number;
  gradientStops?: FigmaGradientStop[];
  gradientAngle?: number;
  scaleMode?: string;
  imageRef?: string;
}

export interface FigmaGradientStop {
  position: number;
  color: { r: number; g: number; b: number; a?: number };
}

export interface FigmaEffect {
  type: "DROP_SHADOW" | "INNER_SHADOW" | "LAYER_BLUR" | "BACKGROUND_BLUR";
  visible: boolean;
  color?: { r: number; g: number; b: number; a?: number };
  offset?: { x: number; y: number };
  radius: number;
  spread?: number;
}

export interface FigmaStyle {
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  lineHeightPx?: number;
  letterSpacing?: number;
  textAlignHorizontal?: string;
}

// ─── Design Tokens ───────────────────────────────────────────

export interface DesignTokenCollection {
  colors: DesignToken[];
  gradients: GradientToken[];
  typography: TypographyToken[];
  spacing: DesignToken[];
  shadows: ShadowToken[];
  borderRadius: DesignToken[];
}

export interface DesignToken {
  name: string;
  value: string;
  source: string;
  category: string;
}

export interface GradientToken {
  name: string;
  type: "linear" | "radial";
  value: string;          // CSS gradient value
  stops: FigmaGradientStop[];
  source: string;
}

export interface TypographyToken {
  name: string;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  source: string;
}

export interface ShadowToken {
  name: string;
  type: "drop-shadow" | "inner-shadow";
  value: string;          // CSS box-shadow value
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: string;
  source: string;
}

// ─── Sync Result ─────────────────────────────────────────────

export interface SyncResult {
  file_name: string;
  icons_downloaded: number;
  images_downloaded: number;
  colors_extracted: number;
  gradients_extracted: number;
  typography_extracted: number;
  shadows_extracted: number;
  spacing_extracted: number;
  tokens_written: string[];
  output_dir: string;
}

// ─── D2C / MasterGo Spec Compiler ────────────────────────────

export type DeviceType = "h5" | "pad" | "web";
export type FrameworkType = "react" | "vue" | "rn" | "flutter" | "miniapp" | "next" | "nuxt" | "html";
export type StyleSystemType = "tailwind" | "unocss" | "css-in-js" | "scss" | "less" | "css-modules" | "css";
export type UnitStrategy = "px" | "rem" | "vw" | "rpx" | "none";

export interface D2CEnvironment {
  deviceType: DeviceType;
  designWidth: number;
  framework: FrameworkType;
  styleSystem: StyleSystemType;
  designSystem: string;
  unitStrategy: UnitStrategy;
  remBase: number;
  viewport: { width: number; height: number };
  isPartialComponent?: boolean;
  svgSprites?: Record<string, string>;
}

export interface MasterGoDslNode extends FigmaNode {
  fillStyleId?: string;
  strokeStyleId?: string;
  textStyleId?: string;
  width?: number; // Ensure width/height are available
  height?: number;
}

export interface D2CSpecNode {
  id: string;
  name: string;
  dslType: string;
  parentId: string | null;
  childrenIds: string[];
  tag: string;
  css: Record<string, string>;
  tailwindClasses?: string;
  attributes: Record<string, string>;
  textContent: string | null;
  svgHtml: string | null;
  variants?: Record<string, {
    css: Record<string, string>;
    tailwindClasses?: string;
  }>;
}

export interface D2CSpec {
  version: string;
  environment: D2CEnvironment;
  nodes: D2CSpecNode[];
}

