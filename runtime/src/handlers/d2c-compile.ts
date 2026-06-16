import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getProjectRoot, textResult, structuredError } from "./_utils.js";
import { detectDesignSystem } from "../visual/design-system-detector.js";
import { cssToTailwind } from "../visual/style-adapters/tailwind.js";
import type { 
  D2CEnvironment, 
  D2CSpec, 
  D2CSpecNode, 
  DeviceType, 
  FrameworkType, 
  StyleSystemType, 
  UnitStrategy,
  MasterGoDslNode
} from "../visual/types.js";

// ═══ 1. Environment Detection ════════════════════════════════════

function detectDeviceType(width: number): DeviceType {
  if (width <= 430) return "h5";
  if (width <= 750) return "h5"; // 2x design
  if (width <= 850) return "pad";
  return "web";
}

function detectFramework(projectRoot: string): FrameworkType {
  const pkgPath = resolve(projectRoot, "package.json");
  if (!existsSync(pkgPath)) return "html";

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps["react-native"]) return "rn";
    if (deps["next"]) return "next";
    if (deps["nuxt"]) return "nuxt";
    if (deps["react"]) return "react";
    if (deps["vue"]) return "vue";
  } catch {
    // ignore parsing errors
  }

  if (existsSync(resolve(projectRoot, "pubspec.yaml"))) return "flutter";
  if (existsSync(resolve(projectRoot, "app.json")) && existsSync(resolve(projectRoot, "miniprogram"))) {
    return "miniapp";
  }

  return "html";
}

function detectStyleSystem(projectRoot: string): StyleSystemType {
  if (
    existsSync(resolve(projectRoot, "tailwind.config.js")) ||
    existsSync(resolve(projectRoot, "tailwind.config.ts")) ||
    existsSync(resolve(projectRoot, "tailwind.config.mjs")) ||
    existsSync(resolve(projectRoot, "tailwind.config.cjs"))
  ) {
    return "tailwind";
  }

  if (existsSync(resolve(projectRoot, "uno.config.ts")) || existsSync(resolve(projectRoot, "uno.config.js"))) {
    return "unocss";
  }

  const pkgPath = resolve(projectRoot, "package.json");
  if (!existsSync(pkgPath)) return "css";

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps["styled-components"] || deps["@emotion/react"]) return "css-in-js";
    if (deps["sass"] || deps["node-sass"]) return "scss";
    if (deps["less"]) return "less";
  } catch {
    // ignore
  }

  // Simple check for CSS modules
  return "css";
}

// ═══ 2. Value Conversion & Helpers ═══════════════════════════════

function rgbaFromFill(fill: any): string {
  if (!fill || fill.visible === false) return "transparent";
  if (fill.colorString) return fill.colorString;
  if (fill.color) {
    const r = Math.round((fill.color.r ?? 0) * 255);
    const g = Math.round((fill.color.g ?? 0) * 255);
    const b = Math.round((fill.color.b ?? 0) * 255);
    const a = fill.color.a ?? fill.opacity ?? 1;
    return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(2))})`;
  }
  return "transparent";
}

function pxToUnit(px: number, strategy: UnitStrategy, designWidth: number): string {
  if (isNaN(px)) return "0";
  switch (strategy) {
    case "px": 
      return `${Math.round(px)}px`;
    case "rem": 
      return `${parseFloat((px / 16).toFixed(4))}rem`;
    case "vw": 
      return `${parseFloat((px / designWidth * 100).toFixed(4))}vw`;
    case "rpx":
      return `${parseFloat((px * (750 / designWidth)).toFixed(2))}rpx`;
    case "none":
      return `${parseFloat(px.toFixed(2))}`;
    default:
      return `${px}px`;
  }
}

// ═══ 3. Tag Mapping ═════════════════════════════════════════════

const TAG_MAP: Record<FrameworkType, Record<string, string>> = {
  html:    { FRAME: "div", TEXT: "span", RECTANGLE: "div", GROUP: "div", INSTANCE: "span", PATH: "span", ELLIPSE: "div", LINE: "div", COMPONENT: "div" },
  react:   { FRAME: "div", TEXT: "span", RECTANGLE: "div", GROUP: "div", INSTANCE: "span", PATH: "span", ELLIPSE: "div", LINE: "div", COMPONENT: "div" },
  vue:     { FRAME: "div", TEXT: "span", RECTANGLE: "div", GROUP: "div", INSTANCE: "span", PATH: "span", ELLIPSE: "div", LINE: "div", COMPONENT: "div" },
  rn:      { FRAME: "View", TEXT: "Text", RECTANGLE: "View", GROUP: "View", INSTANCE: "View", PATH: "Svg", ELLIPSE: "View", LINE: "View", COMPONENT: "View" },
  flutter: { FRAME: "Container", TEXT: "Text", RECTANGLE: "Container", GROUP: "Column", INSTANCE: "Widget", PATH: "SvgPicture", ELLIPSE: "Container", LINE: "Divider", COMPONENT: "Widget" },
  next:    { FRAME: "div", TEXT: "span", RECTANGLE: "div", GROUP: "div", INSTANCE: "span", PATH: "span", ELLIPSE: "div", LINE: "div", COMPONENT: "div" },
  nuxt:    { FRAME: "div", TEXT: "span", RECTANGLE: "div", GROUP: "div", INSTANCE: "span", PATH: "span", ELLIPSE: "div", LINE: "div", COMPONENT: "div" },
  miniapp: { FRAME: "view", TEXT: "text", RECTANGLE: "view", GROUP: "view", INSTANCE: "view", PATH: "view", ELLIPSE: "view", LINE: "view", COMPONENT: "view" },
};

function dslTypeToTag(node: any, framework: FrameworkType): string {
  const nameLower = (node.name || "").toLowerCase();
  const dslType = node.type || "FRAME";
  if (framework === "react" || framework === "vue" || framework === "html" || framework === "next" || framework === "nuxt") {
    if (nameLower.includes("button") && dslType === "FRAME") return "button";
    if (nameLower.includes("input") && dslType === "FRAME") return "input";
  }
  return TAG_MAP[framework]?.[dslType] ?? "div";
}

// ═══ 4. Style Handlers ═══════════════════════════════════════════

function resolveFill(node: any, stylesMap?: Record<string, any>): any {
  if (node.fills && node.fills.length > 0) {
    return node.fills[0];
  }
  if (node.fillStyleId && stylesMap && stylesMap[node.fillStyleId]) {
    const styleDef = stylesMap[node.fillStyleId];
    if (styleDef.fills && styleDef.fills.length > 0) {
      return styleDef.fills[0];
    }
    if (styleDef.color) {
      return styleDef;
    }
  }
  return null;
}

function resolveStroke(node: any, stylesMap?: Record<string, any>): any {
  if (node.strokes && node.strokes.length > 0) {
    return node.strokes[0];
  }
  if (node.strokeStyleId && stylesMap && stylesMap[node.strokeStyleId]) {
    const styleDef = stylesMap[node.strokeStyleId];
    if (styleDef.strokes && styleDef.strokes.length > 0) {
      return styleDef.strokes[0];
    }
    if (styleDef.color) {
      return styleDef;
    }
  }
  return null;
}

const ALIGN_MAP: Record<string, string> = {
  MIN: "flex-start",
  CENTER: "center",
  MAX: "flex-end",
  SPACE_BETWEEN: "space-between",
};

function computeCss(
  node: any,
  env: D2CEnvironment,
  stylesMap?: Record<string, any>
): Record<string, string> {
  const css: Record<string, string> = {};
  const unit = (px: number) => pxToUnit(px, env.unitStrategy, env.designWidth);

  // 1. Layout Mode & Flex
  if (node.layoutMode === "HORIZONTAL") {
    css["display"] = "flex";
    css["flex-direction"] = "row";
  } else if (node.layoutMode === "VERTICAL") {
    css["display"] = "flex";
    css["flex-direction"] = "column";
  } else if (node.children && node.children.length > 0) {
    css["position"] = "relative";
  }

  // 2. Alignment & Gap
  if (node.layoutMode === "HORIZONTAL" || node.layoutMode === "VERTICAL") {
    if (node.itemSpacing !== undefined && node.itemSpacing > 0) {
      css["gap"] = unit(node.itemSpacing);
    }
    if (node.primaryAxisAlignItems) {
      css["justify-content"] = ALIGN_MAP[node.primaryAxisAlignItems] ?? "flex-start";
    }
    if (node.counterAxisAlignItems) {
      css["align-items"] = ALIGN_MAP[node.counterAxisAlignItems] ?? "flex-start";
    }
  }

  // 3. Spacing / Padding
  const pLeft = node.paddingLeft ?? 0;
  const pRight = node.paddingRight ?? 0;
  const pTop = node.paddingTop ?? 0;
  const pBottom = node.paddingBottom ?? 0;

  if (pLeft === pRight && pLeft === pTop && pLeft === pBottom && pLeft > 0) {
    css["padding"] = unit(pLeft);
  } else {
    if (pTop > 0) css["padding-top"] = unit(pTop);
    if (pRight > 0) css["padding-right"] = unit(pRight);
    if (pBottom > 0) css["padding-bottom"] = unit(pBottom);
    if (pLeft > 0) css["padding-left"] = unit(pLeft);
  }

  // 4. Sizing
  if (node.width !== undefined && node.width > 0) {
    css["width"] = unit(node.width);
  }
  if (node.height !== undefined && node.height > 0) {
    css["height"] = unit(node.height);
  }

  // Flex grow and align self
  if (node.layoutGrow === 1) {
    css["flex-grow"] = "1";
  }
  if (node.layoutAlign === "STRETCH") {
    css["align-self"] = "stretch";
  }

  // Absolute positioning
  if (node.layoutPositioning === "ABSOLUTE") {
    css["position"] = "absolute";
    if (node.x !== undefined) css["left"] = unit(node.x);
    if (node.y !== undefined) css["top"] = unit(node.y);
  }

  // 5. Border Radius
  if (node.cornerRadius !== undefined && node.cornerRadius > 0) {
    css["border-radius"] = unit(node.cornerRadius);
  }

  // 6. Background Color or Text Color
  const fill = resolveFill(node, stylesMap);
  if (fill) {
    if (node.type === "TEXT") {
      if (node.textColorString) {
        css["color"] = node.textColorString;
      } else {
        css["color"] = rgbaFromFill(fill);
      }
    } else {
      if (fill.url) {
        css["background-image"] = `url(${fill.url})`;
        css["background-size"] = "cover";
        css["background-position"] = "center";
      } else {
        const colorVal = rgbaFromFill(fill);
        if (colorVal.includes("gradient")) {
          css["background"] = colorVal;
        } else {
          css["background-color"] = colorVal;
        }
      }
    }
  } else if (node.type === "TEXT" && node.textColorString) {
    css["color"] = node.textColorString;
  }

  // 7. Border Stroke
  const stroke = resolveStroke(node, stylesMap);
  if (stroke && node.strokeWeight) {
    css["border-width"] = unit(node.strokeWeight);
    css["border-style"] = "solid";
    if (stroke.colorString) {
      css["border-color"] = stroke.colorString;
    } else {
      css["border-color"] = rgbaFromFill(stroke);
    }
  }

  // 8. Box Shadow (Effects)
  if (node.effects && node.effects.length > 0) {
    const shadow = node.effects.find((e: any) => e.type === "DROP_SHADOW" && e.visible !== false);
    if (shadow) {
      const offsetX = shadow.offset?.x ?? 0;
      const offsetY = shadow.offset?.y ?? 0;
      const radius = shadow.radius ?? 0;
      const spread = shadow.spread ?? 0;
      const color = rgbaFromFill(shadow);
      css["box-shadow"] = `${offsetX}px ${offsetY}px ${radius}px ${spread}px ${color}`;
    }
    const cssEffect = node.effects.find((e: any) => e.type === "CSS_EFFECT");
    if (cssEffect && cssEffect.cssString) {
      const match = cssEffect.cssString.match(/filter:\s*([^;]+)/);
      if (match) {
        css["filter"] = match[1].trim();
      }
    }
  }

  // 9. Opacity
  if (node.opacity !== undefined && node.opacity < 1) {
    css["opacity"] = String(Number(node.opacity.toFixed(2)));
  }

  // 10. Typography
  if (node.type === "TEXT" && node.style) {
    if (node.style.fontSize) {
      css["font-size"] = unit(node.style.fontSize);
    }
    if (node.style.fontWeight) {
      css["font-weight"] = String(node.style.fontWeight);
    }
    if (node.style.fontFamily) {
      css["font-family"] = `"${node.style.fontFamily}"`;
    }
    if (node.style.lineHeightPx) {
      css["line-height"] = unit(node.style.lineHeightPx);
    } else if (node.style.lineHeightPercent) {
      css["line-height"] = `${node.style.lineHeightPercent / 100}`;
    }
    if (node.style.letterSpacing) {
      css["letter-spacing"] = unit(node.style.letterSpacing);
    }
    if (node.style.textAlignHorizontal) {
      const alignMap: Record<string, string> = { LEFT: "left", CENTER: "center", RIGHT: "right", JUSTIFIED: "justify" };
      css["text-align"] = alignMap[node.style.textAlignHorizontal] ?? "left";
    }
  }

  return css;
}

function getTailwindClasses(css: Record<string, string>): string {
  const classes: string[] = [];
  for (const [prop, val] of Object.entries(css)) {
    const tw = cssToTailwind(prop, val);
    if (tw) {
      classes.push(tw);
    } else {
      // Arbitrary values fallback
      if (prop === "background-color" && val !== "transparent") {
        classes.push(`bg-[${val.replace(/\s+/g, "")}]`);
      } else if (prop === "color") {
        classes.push(`text-[${val.replace(/\s+/g, "")}]`);
      } else if (prop === "border-color") {
        classes.push(`border-[${val.replace(/\s+/g, "")}]`);
      } else if (prop === "width" && val.endsWith("px")) {
        classes.push(`w-[${val}]`);
      } else if (prop === "height" && val.endsWith("px")) {
        classes.push(`h-[${val}]`);
      } else if (prop === "gap" && val.endsWith("px")) {
        classes.push(`gap-[${val}]`);
      }
    }
  }
  return classes.join(" ");
}

function normalizeNode(node: any, stylesMap: Record<string, any>, env: D2CEnvironment): any {
  const normalized: any = {
    id: node.id,
    name: node.name || "",
    type: node.type || "FRAME",
    children: node.children || [],
    visible: node.visible !== false,
  };

  // 1. Layout Style normalization
  if (node.layoutStyle) {
    normalized.width = node.layoutStyle.width;
    normalized.height = node.layoutStyle.height;
    normalized.x = node.layoutStyle.relativeX;
    normalized.y = node.layoutStyle.relativeY;
    if (node.layoutStyle.borderRadius) {
      const br = parseFloat(node.layoutStyle.borderRadius);
      if (!isNaN(br)) normalized.cornerRadius = br;
    }
  } else {
    normalized.width = node.width;
    normalized.height = node.height;
    normalized.x = node.x;
    normalized.y = node.y;
    normalized.cornerRadius = node.cornerRadius;
  }

  // 2. Layout mode / Flex properties
  normalized.layoutMode = node.layoutMode || node.layoutStyle?.layoutMode;
  normalized.itemSpacing = node.itemSpacing ?? node.layoutStyle?.itemSpacing;
  normalized.paddingLeft = node.paddingLeft ?? node.layoutStyle?.paddingLeft;
  normalized.paddingRight = node.paddingRight ?? node.layoutStyle?.paddingRight;
  normalized.paddingTop = node.paddingTop ?? node.layoutStyle?.paddingTop;
  normalized.paddingBottom = node.paddingBottom ?? node.layoutStyle?.paddingBottom;
  normalized.layoutGrow = node.layoutGrow ?? node.layoutStyle?.layoutGrow;
  normalized.layoutAlign = node.layoutAlign ?? node.layoutStyle?.layoutAlign;
  normalized.layoutPositioning = node.layoutPositioning ?? node.layoutStyle?.layoutPositioning;
  normalized.primaryAxisAlignItems = node.primaryAxisAlignItems ?? node.layoutStyle?.primaryAxisAlignItems;
  normalized.counterAxisAlignItems = node.counterAxisAlignItems ?? node.layoutStyle?.counterAxisAlignItems;

  // 3. Fills / Colors
  if (node.fills) {
    normalized.fills = node.fills;
  } else if (node.fill) {
    const styleId = node.fill;
    const styleVal = stylesMap && stylesMap[styleId]?.value;
    if (styleVal && styleVal.length > 0) {
      const firstVal = styleVal[0];
      if (typeof firstVal === "string") {
        normalized.fills = [{ type: firstVal.includes("gradient") ? "GRADIENT" : "SOLID", colorString: firstVal }];
      } else if (firstVal && firstVal.url) {
        normalized.fills = [{ type: "IMAGE", url: firstVal.url }];
      }
    } else if (typeof styleId === "string" && (styleId.startsWith("#") || styleId.startsWith("rgb") || styleId === "transparent")) {
      normalized.fills = [{ type: "SOLID", colorString: styleId }];
    }
  }

  // 4. Strokes / Borders
  if (node.strokes) {
    normalized.strokes = node.strokes;
    normalized.strokeWeight = node.strokeWeight;
  } else {
    const strokeColor = node.strokeColor;
    const strokeWidth = node.strokeWidth;
    if (strokeColor) {
      const styleVal = stylesMap && stylesMap[strokeColor]?.value;
      const strokeColorString = (styleVal && styleVal[0]) || strokeColor;
      normalized.strokes = [{ type: "SOLID", colorString: strokeColorString }];
      if (strokeWidth) {
        normalized.strokeWeight = parseFloat(strokeWidth) || 1;
      }
    }
  }

  // 5. Effects / Shadows
  if (node.effects) {
    normalized.effects = node.effects;
  } else if (node.effect) {
    const styleVal = stylesMap && stylesMap[node.effect]?.value;
    if (styleVal && styleVal.length > 0) {
      const effectStr = styleVal[0];
      normalized.effects = [{ type: "CSS_EFFECT", cssString: effectStr }];
    }
  }

  // 6. Text-specific properties
  if (node.type === "TEXT") {
    if (Array.isArray(node.text)) {
      normalized.characters = node.text.map((t: any) => t.text).join("");
    } else {
      normalized.characters = node.characters || node.text || "";
    }

    normalized.style = {};
    if (node.style) {
      normalized.style = { ...node.style };
    } else if (Array.isArray(node.text) && node.text.length > 0) {
      const firstTextObj = node.text[0];
      if (firstTextObj.font) {
        const fontStyle = stylesMap && stylesMap[firstTextObj.font]?.value;
        if (fontStyle) {
          normalized.style.fontFamily = fontStyle.family;
          normalized.style.fontSize = fontStyle.size;
          normalized.style.fontWeight = fontStyle.weight;
          if (fontStyle.lineHeight && fontStyle.lineHeight !== "auto" && fontStyle.lineHeight !== "-1") {
            normalized.style.lineHeightPx = parseFloat(fontStyle.lineHeight);
          }
          if (fontStyle.letterSpacing && fontStyle.letterSpacing !== "auto") {
            normalized.style.letterSpacing = parseFloat(fontStyle.letterSpacing);
          }
        }
      }
    }

    if (node.textColor && node.textColor.length > 0) {
      const colorId = node.textColor[0].color;
      const styleVal = stylesMap && stylesMap[colorId]?.value;
      normalized.textColorString = (styleVal && styleVal[0]) || colorId;
    } else if (node.textColorString) {
      normalized.textColorString = node.textColorString;
    }
  }

  // 7. Path/SVG specific
  if (node.type === "PATH" || node.type === "INSTANCE") {
    normalized.path = node.path;
  }

  return normalized;
}

function getSectionRoots(sect: any): any[] {
  if (!sect) return [];
  if (sect.dsl && Array.isArray(sect.dsl.nodes)) {
    return sect.dsl.nodes;
  }
  if (sect.document) {
    return [sect.document];
  }
  if (Array.isArray(sect)) {
    return sect;
  }
  return [sect];
}

// ═══ 5. Main Handlers & Pipeline ══════════════════════════════════


export async function ritsu_d2c_compile(
  params: Record<string, unknown>
): Promise<CallToolResult> {
  const warnings: string[] = [];

  // Parse inputs
  let dslSectionsRaw = params.dsl_sections;
  if (!dslSectionsRaw) {
    return structuredError("ValidationError", "DSL_SECTIONS_REQUIRED", "dsl_sections is required");
  }

  let sections: any[] = [];
  try {
    const parsed = typeof dslSectionsRaw === "string" ? JSON.parse(dslSectionsRaw) : dslSectionsRaw;
    sections = Array.isArray(parsed) ? parsed : [parsed];
  } catch (err: any) {
    return structuredError("ValidationError", "DSL_SECTIONS_PARSE_ERROR", `Failed to parse dsl_sections: ${err.message}`);
  }

  const rootMetadata: any = params.root_metadata || {};
  const splitContainers = (params.split_containers as any[]) || [];
  const svgsRaw = params.svgs as any;
  const svgs = (svgsRaw && svgsRaw.svgs) || svgsRaw || {};
  const textsRaw = params.texts as any;
  const texts = (textsRaw && textsRaw.texts) || textsRaw || {};

  
  // Merge stylesMap from all sections
  const stylesMap = { ...((params.styles_map as Record<string, any>) || {}) };
  for (const sect of sections) {
    if (sect.dsl && sect.dsl.styles) {
      Object.assign(stylesMap, sect.dsl.styles);
    }
  }


  const projectRoot = params.project_root ? String(params.project_root) : getProjectRoot();

  // Environment detection
  const designWidth = rootMetadata.width || (sections[0]?.width) || 375;
  const designHeight = rootMetadata.height || (sections[0]?.height) || 812;
  const deviceType = detectDeviceType(designWidth);
  const framework = detectFramework(projectRoot);
  const styleSystem = detectStyleSystem(projectRoot);
  const designSystemInfo = detectDesignSystem(projectRoot);

  let unitStrategy: UnitStrategy = "px";
  if (framework === "rn" || framework === "flutter") {
    unitStrategy = "none";
  } else if (framework === "miniapp") {
    unitStrategy = "rpx";
  } else if (deviceType === "h5") {
    unitStrategy = "rem";
  } else if (deviceType === "pad") {
    unitStrategy = "vw";
  } else {
    unitStrategy = "px";
  }

  const env: D2CEnvironment = {
    deviceType,
    designWidth,
    framework,
    styleSystem,
    designSystem: designSystemInfo.name,
    unitStrategy,
    remBase: 16,
    viewport: { width: designWidth, height: designHeight },
  };

  const isPartial = designWidth <= 600 && designHeight <= 600;
  if (isPartial) {
    env.isPartialComponent = true;
  }

  // Reassemble node tree
  const specNodes: D2CSpecNode[] = [];

  // Create root node
  const rootId = rootMetadata.id || "root";
  const rootChildrenIds: string[] = [];

  // Parse sections
  const rawNodesToProcess: { node: any; parentId: string | null }[] = [];

  if (splitContainers.length > 0) {
    // Reassemble using splitContainers
    // Each splitContainer becomes a parent node, and we place the section roots under it.
    for (const sc of splitContainers) {
      const scNodeId = sc.id || `sc-${sc.name}`;
      const scChildrenIds: string[] = [];

      // Create split container spec node
      const scCss = computeCss(sc, env, stylesMap);
      const scSpecNode: D2CSpecNode = {
        id: scNodeId,
        name: sc.name || "Split Container",
        dslType: sc.type || "FRAME",
        parentId: rootId,
        childrenIds: scChildrenIds,
        tag: dslTypeToTag(sc, framework),
        css: scCss,
        attributes: {
          "data-mg-id": scNodeId,
          "data-mg-name": sc.name || "Split Container",
        },
        textContent: null,
        svgHtml: null,
      };
      if (env.styleSystem === "tailwind") {
        scSpecNode.tailwindClasses = getTailwindClasses(scCss);
      }
      specNodes.push(scSpecNode);
      rootChildrenIds.push(scNodeId);

      // Distribute sections to this split container
      // If sections match container ID or order, place them
      for (const sect of sections) {
        // Find roots in section
        const roots = getSectionRoots(sect);
        for (const root of roots) {
          if (!root) continue;
          // Set parent to split container
          rawNodesToProcess.push({ node: root, parentId: scNodeId });
          scChildrenIds.push(root.id);
        }
      }
    }
  } else {
    // No split containers, connect section roots directly to the root node
    for (const sect of sections) {
      const roots = getSectionRoots(sect);
      for (const root of roots) {
        if (!root) continue;
        rawNodesToProcess.push({ node: root, parentId: rootId });
        rootChildrenIds.push(root.id);
      }
    }
  }

  // Create page root node
  const rootCss = computeCss(rootMetadata, env, stylesMap);
  if (env.isPartialComponent) {
    if (rootCss["width"]) {
      rootCss["max-width"] = rootCss["width"];
      rootCss["width"] = "100%";
    } else {
      rootCss["width"] = "100%";
    }
    rootCss["height"] = "auto";
    if (rootCss["position"] === "absolute") {
      delete rootCss["position"];
      delete rootCss["left"];
      delete rootCss["top"];
    }
  }
  const rootSpecNode: D2CSpecNode = {
    id: rootId,
    name: rootMetadata.name || "Page Root",
    dslType: rootMetadata.type || "FRAME",
    parentId: null,
    childrenIds: rootChildrenIds,
    tag: dslTypeToTag(rootMetadata, framework),
    css: rootCss,
    attributes: {
      "data-mg-id": rootId,
      "data-mg-name": rootMetadata.name || "Page Root",
    },
    textContent: null,
    svgHtml: null,
  };
  if (env.styleSystem === "tailwind") {
    rootSpecNode.tailwindClasses = getTailwindClasses(rootCss);
  }
  specNodes.push(rootSpecNode);

  // Flatten and process all children nodes recursively
  while (rawNodesToProcess.length > 0) {
    let { node, parentId } = rawNodesToProcess.shift()!;
    if (!node) continue;

    // Normalize node format (Figma standard vs MasterGo D2C format)
    node = normalizeNode(node, stylesMap, env);


    // Resolve SVG
    let svgHtml: string | null = null;
    const matchKey = Object.keys(svgs).find(
      k => k.endsWith(`|${node.id}`) || k.includes(`|${node.id}`)
    );
    if (matchKey) {
      svgHtml = svgs[matchKey];
    }

    // Resolve Text content
    let textContent: string | null = null;
    if (node.type === "TEXT") {
      const rawText = node.characters || (node.text as unknown as string) || "";
      if (rawText && typeof rawText === "string") {
        if (texts[rawText]) {
          textContent = texts[rawText];
        } else {
          textContent = rawText;
        }
      }
      if (!textContent && texts[node.id]) {
        textContent = texts[node.id];
      }
    }

    // Compute styles
    const css = computeCss(node, env, stylesMap);

    const childrenIds = (node.children || [])
      .filter((c: any) => c && c.visible !== false)
      .map((c: any) => c.id);

    const specNode: D2CSpecNode = {
      id: node.id,
      name: node.name || "",
      dslType: node.type || "FRAME",
      parentId,
      childrenIds,
      tag: dslTypeToTag(node, framework),
      css,
      attributes: {
        "data-mg-id": node.id,
        "data-mg-name": node.name || "",
      },
      textContent,
      svgHtml,
    };

    if (env.styleSystem === "tailwind") {
      specNode.tailwindClasses = getTailwindClasses(css);
    }

    specNodes.push(specNode);

    // Queue children
    if (node.children) {
      for (const child of node.children) {
        if (child && child.visible !== false) {
          rawNodesToProcess.push({ node: child, parentId: node.id });
        }
      }
    }
  }

  // ═══ SVG Sprite Centralization & De-duplication ═══
  const svgSprites: Record<string, string> = {};
  let spriteCount = 0;
  for (const node of specNodes) {
    if (node.svgHtml) {
      const cleanedSvg = node.svgHtml.trim();
      let spriteId = Object.keys(svgSprites).find(k => svgSprites[k] === cleanedSvg);
      if (!spriteId) {
        spriteCount++;
        spriteId = `svg-sprite-${spriteCount}`;
        svgSprites[spriteId] = cleanedSvg;
      }
      node.attributes["data-mg-svg-sprite"] = spriteId;
    }
  }
  if (spriteCount > 0) {
    const compiledSprites: Record<string, string> = {};
    for (const [spriteId, svgContent] of Object.entries(svgSprites)) {
      compiledSprites[spriteId] = convertSvgToSymbol(svgContent, spriteId);
    }
    env.svgSprites = compiledSprites;
  }

  // ═══ Sibling State & Variant Grouping/Diffing ═══
  processVariantsAndStates(specNodes, env);

  // ═══ Tree-Shaking (Collapse Redundant Wrappers) ═══
  while (collapseRedundantWrappers(specNodes)) {
    // continue until no change
  }

  // Construct Spec
  const spec: D2CSpec = {
    version: "1.0.0",
    environment: env,
    nodes: specNodes,
  };

  // Write spec file to disk
  const specPath = resolve(projectRoot, "d2c-spec.json");
  try {
    writeFileSync(specPath, JSON.stringify(spec, null, 2), "utf-8");
  } catch (err: any) {
    return structuredError("ExecutionError", "WRITE_SPEC_FAILED", `Failed to write d2c-spec.json: ${err.message}`);
  }

  return textResult(
    JSON.stringify({
      ok: true,
      spec_path: specPath,
      environment: env,
      total_nodes: specNodes.length,
      warnings,
    }, null, 2)
  );
}

// ═══ D2C Compiler Optimizations Helper Functions ═════════════════

function convertSvgToSymbol(svgContent: string, spriteId: string): string {
  const viewBoxMatch = svgContent.match(/viewBox=["']([^"']+)["']/i);
  const viewBoxAttr = viewBoxMatch ? ` viewBox="${viewBoxMatch[1]}"` : "";
  const innerContent = svgContent
    .replace(/<svg[^>]*>/i, "")
    .replace(/<\/svg>/i, "")
    .trim();
  return `<symbol id="${spriteId}"${viewBoxAttr}>${innerContent}</symbol>`;
}

function parseNodeStateAndBaseName(nodeName: string): { baseName: string; state: string | null } {
  if (nodeName.includes("/")) {
    const parts = nodeName.split("/");
    const baseName = parts.slice(0, -1).join("/").trim();
    const suffix = parts[parts.length - 1].trim().toLowerCase();
    const knownStates = ["hover", "active", "disabled", "focus", "selected", "default", "normal", "pressed", "checked"];
    if (knownStates.includes(suffix)) {
      return { baseName, state: suffix === "default" || suffix === "normal" ? "default" : suffix };
    }
    return { baseName: nodeName, state: null };
  }

  if (nodeName.includes("=")) {
    const pairs = nodeName.split(",").map(p => p.trim());
    const props: Record<string, string> = {};
    for (const pair of pairs) {
      const eqIdx = pair.indexOf("=");
      if (eqIdx > 0) {
        const k = pair.slice(0, eqIdx).trim().toLowerCase();
        const v = pair.slice(eqIdx + 1).trim().toLowerCase();
        props[k] = v;
      }
    }

    if (props["state"]) {
      const baseParts = pairs.filter(p => !p.toLowerCase().startsWith("state="));
      const baseName = baseParts.join(", ");
      const state = props["state"];
      return { baseName, state: state === "default" || state === "normal" ? "default" : state };
    }
  }

  return { baseName: nodeName, state: null };
}

function diffNodeTreeStyles(
  baseNode: D2CSpecNode,
  otherNode: D2CSpecNode,
  state: string,
  specNodes: D2CSpecNode[],
  env: D2CEnvironment
) {
  const cssDiff: Record<string, string> = {};
  for (const [key, val] of Object.entries(otherNode.css)) {
    if (baseNode.css[key] !== val) {
      cssDiff[key] = val;
    }
  }
  for (const key of Object.keys(baseNode.css)) {
    if (!(key in otherNode.css)) {
      cssDiff[key] = "initial";
    }
  }

  if (Object.keys(cssDiff).length > 0) {
    if (!baseNode.variants) baseNode.variants = {};
    const varEntry: { css: Record<string, string>; tailwindClasses?: string } = { css: cssDiff };
    
    if (env.styleSystem === "tailwind") {
      const diffClasses = getTailwindClasses(cssDiff);
      if (diffClasses) {
        varEntry.tailwindClasses = diffClasses
          .split(/\s+/)
          .filter(Boolean)
          .map(c => `${state}:${c}`)
          .join(" ");
      }
    }
    
    baseNode.variants[state] = varEntry;
  }

  const baseChildren = baseNode.childrenIds
    .map(id => specNodes.find(n => n.id === id))
    .filter(Boolean) as D2CSpecNode[];
  const otherChildren = otherNode.childrenIds
    .map(id => specNodes.find(n => n.id === id))
    .filter(Boolean) as D2CSpecNode[];

  const minLen = Math.min(baseChildren.length, otherChildren.length);
  for (let i = 0; i < minLen; i++) {
    diffNodeTreeStyles(baseChildren[i], otherChildren[i], state, specNodes, env);
  }
}

function removeNodeAndDescendants(nodeId: string, specNodes: D2CSpecNode[]) {
  const index = specNodes.findIndex(n => n.id === nodeId);
  if (index !== -1) {
    const node = specNodes[index];
    specNodes.splice(index, 1);
    for (const childId of node.childrenIds) {
      removeNodeAndDescendants(childId, specNodes);
    }
  }
}

function processVariantsAndStates(specNodes: D2CSpecNode[], env: D2CEnvironment) {
  const parentToChildren = new Map<string | null, D2CSpecNode[]>();
  for (const node of specNodes) {
    const pId = node.parentId;
    if (!parentToChildren.has(pId)) {
      parentToChildren.set(pId, []);
    }
    parentToChildren.get(pId)!.push(node);
  }

  for (const [parentId, children] of parentToChildren.entries()) {
    const nameGroups = new Map<string, { state: string; node: D2CSpecNode }[]>();
    for (const child of children) {
      const { baseName, state } = parseNodeStateAndBaseName(child.name);
      if (state) {
        if (!nameGroups.has(baseName)) {
          nameGroups.set(baseName, []);
        }
        nameGroups.get(baseName)!.push({ state, node: child });
      }
    }

    for (const [baseName, entries] of nameGroups.entries()) {
      if (entries.length <= 1) continue;

      let baseIdx = entries.findIndex(e => e.state === "default" || e.state === "normal");
      if (baseIdx === -1) baseIdx = 0;
      const baseEntry = entries[baseIdx];
      const baseNode = baseEntry.node;

      baseNode.name = baseName;
      baseNode.attributes["data-mg-name"] = baseName;

      for (let i = 0; i < entries.length; i++) {
        if (i === baseIdx) continue;
        const otherEntry = entries[i];
        const otherNode = otherEntry.node;

        diffNodeTreeStyles(baseNode, otherNode, otherEntry.state, specNodes, env);

        if (parentId) {
          const parentNode = specNodes.find(n => n.id === parentId);
          if (parentNode) {
            parentNode.childrenIds = parentNode.childrenIds.filter(id => id !== otherNode.id);
          }
        }

        removeNodeAndDescendants(otherNode.id, specNodes);
      }
    }
  }
}

function mergeCss(targetCss: Record<string, string>, sourceCss: Record<string, string>) {
  const propsToMerge = [
    "position", "left", "top", "right", "bottom",
    "flex-grow", "flex-shrink", "flex-basis", "align-self",
    "margin", "margin-top", "margin-right", "margin-bottom", "margin-left"
  ];
  for (const prop of propsToMerge) {
    if (sourceCss[prop]) {
      targetCss[prop] = sourceCss[prop];
    }
  }
  if (sourceCss["width"] && (!targetCss["width"] || targetCss["width"] === "100%" || targetCss["width"] === "100vw")) {
    targetCss["width"] = sourceCss["width"];
  }
  if (sourceCss["height"] && (!targetCss["height"] || targetCss["height"] === "100%" || targetCss["height"] === "100vh")) {
    targetCss["height"] = sourceCss["height"];
  }
}

function collapseRedundantWrappers(specNodes: D2CSpecNode[]): boolean {
  let changed = false;
  for (let i = 0; i < specNodes.length; i++) {
    const node = specNodes[i];
    if (node.parentId === null) continue;

    if (node.childrenIds.length === 1 && !node.textContent && !node.svgHtml) {
      const tag = node.tag.toLowerCase();
      if (tag === "div" || tag === "view" || tag === "container") {
        const hasVisual = 
          (node.css["background-color"] && node.css["background-color"] !== "transparent") ||
          (node.css["background"] && node.css["background"] !== "transparent") ||
          (node.css["border-width"] && node.css["border-width"] !== "0px" && node.css["border-width"] !== "0") ||
          node.css["box-shadow"] ||
          (node.css["opacity"] && node.css["opacity"] !== "1") ||
          node.css["filter"] ||
          node.css["padding"] || node.css["padding-top"] || node.css["padding-right"] || node.css["padding-bottom"] || node.css["padding-left"];

        if (!hasVisual) {
          const parentNode = specNodes.find(n => n.id === node.parentId);
          const childNode = specNodes.find(n => n.id === node.childrenIds[0]);

          if (parentNode && childNode) {
            parentNode.childrenIds = parentNode.childrenIds.map(id => id === node.id ? childNode.id : id);
            childNode.parentId = parentNode.id;

            mergeCss(childNode.css, node.css);

            if (childNode.tailwindClasses) {
              childNode.tailwindClasses = getTailwindClasses(childNode.css);
            }

            specNodes.splice(i, 1);
            changed = true;
            break;
          }
        }
      }
    }
  }
  return changed;
}

