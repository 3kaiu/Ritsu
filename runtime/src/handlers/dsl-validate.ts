import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getProjectRoot, textResult, structuredError } from "./_utils.js";
import { JSDOM } from "jsdom";
import type { D2CSpec, D2CSpecNode } from "../visual/types.js";

interface StyleMismatch {
  nodeId: string;
  nodeName: string;
  property: string;
  expected: string;
  actual: string;
  severity: "critical" | "major" | "minor";
  suggestion: string;
}

function parseStyleAttribute(styleStr: string): Record<string, string> {
  const styles: Record<string, string> = {};
  if (!styleStr) return styles;
  const parts = styleStr.split(";");
  for (const part of parts) {
    const colonIndex = part.indexOf(":");
    if (colonIndex > 0) {
      const key = part.slice(0, colonIndex).trim().toLowerCase();
      const val = part.slice(colonIndex + 1).trim();
      if (key && val) {
        styles[key] = val;
      }
    }
  }
  return styles;
}

export async function ritsu_dsl_validate(
  params: Record<string, unknown>
): Promise<CallToolResult> {
  const htmlPathRaw = params.html_path;
  const specPathRaw = params.spec_path;

  if (!htmlPathRaw) {
    return structuredError("ValidationError", "HTML_PATH_REQUIRED", "html_path is required");
  }
  if (!specPathRaw) {
    return structuredError("ValidationError", "SPEC_PATH_REQUIRED", "spec_path is required");
  }

  const projectRoot = getProjectRoot();
  const htmlPath = resolve(projectRoot, String(htmlPathRaw));
  const specPath = resolve(projectRoot, String(specPathRaw));

  if (!existsSync(htmlPath)) {
    return structuredError("ValidationError", "HTML_FILE_NOT_FOUND", `HTML/code file not found: ${htmlPathRaw}`);
  }
  if (!existsSync(specPath)) {
    return structuredError("ValidationError", "SPEC_FILE_NOT_FOUND", `Spec file not found: ${specPathRaw}`);
  }

  // Parse Spec
  let spec: D2CSpec;
  try {
    spec = JSON.parse(readFileSync(specPath, "utf-8"));
  } catch (err: any) {
    return structuredError("ValidationError", "SPEC_PARSE_FAILED", `Failed to parse spec JSON: ${err.message}`);
  }

  // Parse HTML
  let codeContent = "";
  try {
    codeContent = readFileSync(htmlPath, "utf-8");
  } catch (err: any) {
    return structuredError("ExecutionError", "HTML_READ_FAILED", `Failed to read HTML file: ${err.message}`);
  }

  const dom = new JSDOM(codeContent);
  const document = dom.window.document;

  const totalNodes = spec.nodes.length;
  let matchedCount = 0;
  const missingNodes: { id: string; name: string; type: string }[] = [];
  const mismatchedStyles: StyleMismatch[] = [];

  let totalNodeScore = 0;

  for (const specNode of spec.nodes) {
    // Find element by data-mg-id
    const element = document.querySelector(`[data-mg-id="${specNode.id}"]`);

    if (!element) {
      missingNodes.push({
        id: specNode.id,
        name: specNode.name,
        type: specNode.dslType,
      });
      continue;
    }

    matchedCount++;
    let nodeScore = 100;

    // 0. Hierarchy comparison (closest ancestor with data-mg-id)
    let parentElement = element.parentElement;
    let actualParentId: string | null = null;
    while (parentElement) {
      const mid = parentElement.getAttribute("data-mg-id");
      if (mid) {
        actualParentId = mid;
        break;
      }
      parentElement = parentElement.parentElement;
    }
    if (actualParentId !== specNode.parentId) {
      nodeScore -= 20;
      mismatchedStyles.push({
        nodeId: specNode.id,
        nodeName: specNode.name,
        property: "hierarchy",
        expected: specNode.parentId ? `Parent ID: ${specNode.parentId}` : "No parent (root)",
        actual: actualParentId ? `Parent ID: ${actualParentId}` : "No parent (root)",
        severity: "major",
        suggestion: specNode.parentId 
          ? `Move this element so it is nested inside the element with data-mg-id="${specNode.parentId}"`
          : `Move this element to the root level (outside any other data-mg-id elements)`
      });
    }

    // 1. Tag comparison (case-insensitive)
    const actualTag = element.tagName.toLowerCase();
    const expectedTag = specNode.tag.toLowerCase();
    if (actualTag !== expectedTag) {
      nodeScore -= 20;
      mismatchedStyles.push({
        nodeId: specNode.id,
        nodeName: specNode.name,
        property: "tag",
        expected: expectedTag,
        actual: actualTag,
        severity: "major",
        suggestion: `Change HTML tag from <${actualTag}> to <${expectedTag}>`
      });
    }

    // 2. Text Content comparison (if applicable)
    if (specNode.textContent) {
      const actualText = (element.textContent || "").trim().toLowerCase();
      const expectedText = specNode.textContent.trim().toLowerCase();
      if (!actualText.includes(expectedText)) {
        nodeScore -= 25;
        mismatchedStyles.push({
          nodeId: specNode.id,
          nodeName: specNode.name,
          property: "textContent",
          expected: specNode.textContent,
          actual: element.textContent || "",
          severity: "major",
          suggestion: `Update text content of the element to match or include "${specNode.textContent}"`
        });
      }
    }

    // 3. SVG HTML comparison (if applicable)
    if (specNode.svgHtml) {
      const hasSvg = element.querySelector("svg");
      if (!hasSvg) {
        nodeScore -= 30;
        mismatchedStyles.push({
          nodeId: specNode.id,
          nodeName: specNode.name,
          property: "svgHtml",
          expected: "An inline <svg> element",
          actual: "No <svg> child element found",
          severity: "critical",
          suggestion: `Insert the exact SVG HTML code inside this element: ${specNode.svgHtml}`
        });
      }
    }

    // 4. Styles validation
    if (spec.environment.styleSystem === "tailwind" && specNode.tailwindClasses) {
      const classAttr = element.getAttribute("class") || element.getAttribute("className") || "";
      const actualClasses = classAttr.split(/\s+/).filter(Boolean);
      const expectedClasses = specNode.tailwindClasses.split(/\s+/).filter(Boolean);

      const missingClasses: string[] = [];
      for (const cls of expectedClasses) {
        if (!actualClasses.includes(cls)) {
          missingClasses.push(cls);
        }
      }

      if (missingClasses.length > 0) {
        const penalty = Math.min(50, missingClasses.length * 10);
        nodeScore -= penalty;
        mismatchedStyles.push({
          nodeId: specNode.id,
          nodeName: specNode.name,
          property: "tailwindClasses",
          expected: specNode.tailwindClasses,
          actual: classAttr,
          severity: missingClasses.length > 3 ? "critical" : "minor",
          suggestion: `Add the following missing Tailwind classes to the element: ${missingClasses.join(" ")}`
        });
      }
    } else {
      // Inline styles comparison
      const styleAttr = element.getAttribute("style") || "";
      const actualStyles = parseStyleAttribute(styleAttr);

      let mismatchedStyleCount = 0;
      for (const [prop, expectedVal] of Object.entries(specNode.css)) {
        const actualVal = actualStyles[prop];
        if (!actualVal) {
          mismatchedStyleCount++;
          mismatchedStyles.push({
            nodeId: specNode.id,
            nodeName: specNode.name,
            property: `css:${prop}`,
            expected: expectedVal,
            actual: "undefined",
            severity: "minor",
            suggestion: `Add style property "${prop}: ${expectedVal}"`
          });
        } else if (actualVal.replace(/\s+/g, "") !== expectedVal.replace(/\s+/g, "")) {
          mismatchedStyleCount++;
          mismatchedStyles.push({
            nodeId: specNode.id,
            nodeName: specNode.name,
            property: `css:${prop}`,
            expected: expectedVal,
            actual: actualVal,
            severity: "minor",
            suggestion: `Change style property "${prop}" from "${actualVal}" to "${expectedVal}"`
          });
        }
      }

      if (mismatchedStyleCount > 0) {
        const penalty = Math.min(50, mismatchedStyleCount * 10);
        nodeScore -= penalty;
      }
    }

    totalNodeScore += Math.max(0, nodeScore);
  }

  // Calculate final score
  // Missing nodes contribute 0 to the score
  const finalScore = totalNodes > 0 ? Math.round(totalNodeScore / totalNodes) : 0;
  const isOk = finalScore >= 95 && missingNodes.length === 0;

  return textResult(
    JSON.stringify({
      ok: isOk,
      score: finalScore,
      total_nodes: totalNodes,
      matched_nodes: matchedCount,
      missing_nodes: missingNodes,
      mismatched_styles: mismatchedStyles,
    }, null, 2)
  );
}
