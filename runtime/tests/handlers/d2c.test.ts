import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ritsu_d2c_compile } from "../../src/handlers/d2c-compile.js";
import { ritsu_dsl_validate } from "../../src/handlers/dsl-validate.js";
import { getProjectRoot } from "../../src/handlers/_utils.js";

describe("D2C Compiler & Validator Handlers", () => {
  const root = getProjectRoot();
  const specPath = resolve(root, "d2c-spec.json");
  const htmlPath = resolve(root, "test-output.html");

  const mockDsl = [
    {
      id: "1:2",
      name: "Header",
      type: "FRAME",
      layoutMode: "HORIZONTAL",
      itemSpacing: 8,
      paddingLeft: 16,
      paddingRight: 16,
      width: 375,
      height: 64,
      fills: [
        {
          type: "SOLID",
          color: { r: 0.1, g: 0.2, b: 0.3, a: 1 }
        }
      ],
      children: [
        {
          id: "1:3",
          name: "Title",
          type: "TEXT",
          characters: "Settings",
          style: {
            fontSize: 16,
            fontWeight: 600,
            lineHeightPx: 24
          }
        }
      ]
    }
  ];

  const mockRootMetadata = {
    id: "root-page",
    name: "Main Page",
    type: "FRAME",
    width: 375,
    height: 812
  };

  afterEach(() => {
    if (existsSync(specPath)) unlinkSync(specPath);
    if (existsSync(htmlPath)) unlinkSync(htmlPath);
  });

  it("should compile raw MasterGo DSL into a spec.json", async () => {
    const res = await ritsu_d2c_compile({
      dsl_sections: JSON.stringify(mockDsl),
      root_metadata: mockRootMetadata
    });

    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.spec_path).toBe(specPath);
    expect(parsed.total_nodes).toBe(3); // root + header + title

    const spec = JSON.parse(readFileSync(specPath, "utf-8"));
    expect(spec.version).toBe("1.0.0");
    expect(spec.environment.deviceType).toBe("h5");
    expect(spec.environment.unitStrategy).toBe("rem");

    // Title Node Checks
    const titleNode = spec.nodes.find((n: any) => n.id === "1:3");
    expect(titleNode).toBeDefined();
    expect(titleNode.tag).toBe("span");
    expect(titleNode.textContent).toBe("Settings");
    expect(titleNode.css["font-size"]).toBe("1rem"); // 16px -> 1rem
    expect(titleNode.css["font-weight"]).toBe("600");
  });

  it("should validate code against spec.json and return score", async () => {
    // 1. Compile spec first
    await ritsu_d2c_compile({
      dsl_sections: JSON.stringify(mockDsl),
      root_metadata: mockRootMetadata
    });

    // 2. Write valid mock code
    const validHtml = `
      <div data-mg-id="root-page" data-mg-name="Main Page" style="width: 23.4375rem; height: 50.75rem;">
        <div data-mg-id="1:2" data-mg-name="Header" style="display: flex; flex-direction: row; gap: 0.5rem; padding-left: 1rem; padding-right: 1rem; width: 23.4375rem; height: 4rem; background-color: rgba(26, 51, 77, 1);">
          <span data-mg-id="1:3" data-mg-name="Title" style="font-size: 1rem; font-weight: 600; line-height: 1.5rem;">Settings</span>
        </div>
      </div>
    `;
    writeFileSync(htmlPath, validHtml, "utf-8");

    // 3. Validate
    const valRes = await ritsu_dsl_validate({
      html_path: "test-output.html",
      spec_path: "d2c-spec.json"
    });

    const valParsed = JSON.parse(valRes.content[0].text);
    expect(valParsed.ok).toBe(true);
    expect(valParsed.score).toBeGreaterThanOrEqual(95);
    expect(valParsed.missing_nodes.length).toBe(0);
    expect(valParsed.mismatched_styles.length).toBe(0);
  });

  it("should detect missing nodes and mismatched styles", async () => {
    await ritsu_d2c_compile({
      dsl_sections: JSON.stringify(mockDsl),
      root_metadata: mockRootMetadata
    });

    // Write HTML missing the Title node and having wrong background on header
    const invalidHtml = `
      <div data-mg-id="root-page" data-mg-name="Main Page" style="width: 375px; height: 812px;">
        <div data-mg-id="1:2" data-mg-name="Header" style="display: block; width: 375px; height: 64px; background-color: rgba(255, 0, 0, 1);">
          <!-- Title is missing -->
        </div>
      </div>
    `;
    writeFileSync(htmlPath, invalidHtml, "utf-8");

    const valRes = await ritsu_dsl_validate({
      html_path: "test-output.html",
      spec_path: "d2c-spec.json"
    });

    const valParsed = JSON.parse(valRes.content[0].text);
    expect(valParsed.ok).toBe(false);
    expect(valParsed.score).toBeLessThan(95);
    expect(valParsed.missing_nodes.some((n: any) => n.id === "1:3")).toBe(true);
    expect(valParsed.mismatched_styles.some((s: any) => s.nodeId === "1:2" && s.property === "css:background-color")).toBe(true);
  });

  it("should detect hierarchy/nesting violations", async () => {
    await ritsu_d2c_compile({
      dsl_sections: JSON.stringify(mockDsl),
      root_metadata: mockRootMetadata
    });

    // Write HTML where Title is sibling of Header instead of child of Header
    const invalidHtml = `
      <div data-mg-id="root-page" data-mg-name="Main Page" style="width: 23.4375rem; height: 50.75rem;">
        <div data-mg-id="1:2" data-mg-name="Header" style="display: flex; flex-direction: row; gap: 0.5rem; padding-left: 1rem; padding-right: 1rem; width: 23.4375rem; height: 4rem; background-color: rgba(26, 51, 77, 1);">
        </div>
        <!-- Title is placed outside Header, violating nesting -->
        <span data-mg-id="1:3" data-mg-name="Title" style="font-size: 1rem; font-weight: 600; line-height: 1.5rem;">Settings</span>
      </div>
    `;
    writeFileSync(htmlPath, invalidHtml, "utf-8");

    const valRes = await ritsu_dsl_validate({
      html_path: "test-output.html",
      spec_path: "d2c-spec.json"
    });

    const valParsed = JSON.parse(valRes.content[0].text);
    expect(valParsed.ok).toBe(false);
    expect(valParsed.mismatched_styles.some((s: any) => s.nodeId === "1:3" && s.property === "hierarchy")).toBe(true);
    const hierarchyMismatch = valParsed.mismatched_styles.find((s: any) => s.nodeId === "1:3" && s.property === "hierarchy");
    expect(hierarchyMismatch.suggestion).toContain("Move this element so it is nested inside the element with data-mg-id=\"1:2\"");
  });

  it("should detect missing SVG child elements", async () => {
    // Compile spec with an SVG node
    const dslWithSvg = [
      {
        id: "1:2",
        name: "Header",
        type: "FRAME",
        width: 375,
        height: 64,
        children: [
          {
            id: "1:4",
            name: "icon_arrow",
            type: "PATH",
            width: 24,
            height: 24,
          }
        ]
      }
    ];
    const svgsMap = {
      "icon_arrow|1:4": "<svg viewBox='0 0 24 24'><path d='M0 0h24v24H0z'/></svg>"
    };

    await ritsu_d2c_compile({
      dsl_sections: JSON.stringify(dslWithSvg),
      root_metadata: mockRootMetadata,
      svgs: svgsMap
    });

    // Write HTML where icon_arrow is missing <svg> child element
    const invalidHtml = `
      <div data-mg-id="root-page" data-mg-name="Main Page" style="width: 23.4375rem; height: 50.75rem;">
        <div data-mg-id="1:2" data-mg-name="Header" style="width: 23.4375rem; height: 4rem;">
          <span data-mg-id="1:4" data-mg-name="icon_arrow">No SVG here!</span>
        </div>
      </div>
    `;
    writeFileSync(htmlPath, invalidHtml, "utf-8");

    const valRes = await ritsu_dsl_validate({
      html_path: "test-output.html",
      spec_path: "d2c-spec.json"
    });

    const valParsed = JSON.parse(valRes.content[0].text);
    expect(valParsed.ok).toBe(false);
    expect(valParsed.mismatched_styles.some((s: any) => s.nodeId === "1:4" && s.property === "svgHtml")).toBe(true);
    const svgMismatch = valParsed.mismatched_styles.find((s: any) => s.nodeId === "1:4" && s.property === "svgHtml");
    expect(svgMismatch.suggestion).toContain("Insert the exact SVG HTML code");
  });

  it("should support diverse unit strategies for miniapp, rn, pad, and web", async () => {
    // 1. Pad unit strategy (vw)
    const padMetadata = { ...mockRootMetadata, width: 768, height: 1024 };
    await ritsu_d2c_compile({
      dsl_sections: JSON.stringify(mockDsl),
      root_metadata: padMetadata
    });
    const padSpec = JSON.parse(readFileSync(specPath, "utf-8"));
    expect(padSpec.environment.deviceType).toBe("pad");
    expect(padSpec.environment.unitStrategy).toBe("vw");
    const padTitleNode = padSpec.nodes.find((n: any) => n.id === "1:3");
    expect(padTitleNode.css["font-size"]).toBe("2.0833vw");

    // 2. Web unit strategy (px)
    const webMetadata = { ...mockRootMetadata, width: 1200, height: 900 };
    await ritsu_d2c_compile({
      dsl_sections: JSON.stringify(mockDsl),
      root_metadata: webMetadata
    });
    const webSpec = JSON.parse(readFileSync(specPath, "utf-8"));
    expect(webSpec.environment.deviceType).toBe("web");
    expect(webSpec.environment.unitStrategy).toBe("px");
    const webTitleNode = webSpec.nodes.find((n: any) => n.id === "1:3");
    expect(webTitleNode.css["font-size"]).toBe("16px");

    // 3. React Native / RN framework (none)
    const rnTempDir = resolve(root, "temp_rn_test");
    const fs = require("node:fs");
    if (!fs.existsSync(rnTempDir)) fs.mkdirSync(rnTempDir);
    fs.writeFileSync(resolve(rnTempDir, "package.json"), JSON.stringify({ dependencies: { "react-native": "0.71.0" } }), "utf-8");
    
    await ritsu_d2c_compile({
      dsl_sections: JSON.stringify(mockDsl),
      root_metadata: mockRootMetadata,
      project_root: rnTempDir
    });
    const rnSpecPath = resolve(rnTempDir, "d2c-spec.json");
    const rnSpec = JSON.parse(fs.readFileSync(rnSpecPath, "utf-8"));
    expect(rnSpec.environment.framework).toBe("rn");
    expect(rnSpec.environment.unitStrategy).toBe("none");
    const rnTitleNode = rnSpec.nodes.find((n: any) => n.id === "1:3");
    expect(rnTitleNode.css["font-size"]).toBe("16");
    
    // Clean up RN temp
    if (fs.existsSync(rnSpecPath)) fs.unlinkSync(rnSpecPath);
    if (fs.existsSync(resolve(rnTempDir, "package.json"))) fs.unlinkSync(resolve(rnTempDir, "package.json"));
    fs.rmSync(rnTempDir, { recursive: true, force: true });

    // 4. Miniapp framework (rpx)
    const miniTempDir = resolve(root, "temp_mini_test");
    if (!fs.existsSync(miniTempDir)) fs.mkdirSync(miniTempDir);
    fs.writeFileSync(resolve(miniTempDir, "app.json"), "{}", "utf-8");
    fs.mkdirSync(resolve(miniTempDir, "miniprogram"));
    fs.writeFileSync(resolve(miniTempDir, "package.json"), JSON.stringify({}), "utf-8");

    await ritsu_d2c_compile({
      dsl_sections: JSON.stringify(mockDsl),
      root_metadata: mockRootMetadata, // width 375
      project_root: miniTempDir
    });
    const miniSpecPath = resolve(miniTempDir, "d2c-spec.json");
    const miniSpec = JSON.parse(fs.readFileSync(miniSpecPath, "utf-8"));
    expect(miniSpec.environment.framework).toBe("miniapp");
    expect(miniSpec.environment.unitStrategy).toBe("rpx");
    const miniTitleNode = miniSpec.nodes.find((n: any) => n.id === "1:3");
    expect(miniTitleNode.css["font-size"]).toBe("32rpx");

    // Clean up Miniapp temp
    if (fs.existsSync(miniSpecPath)) fs.unlinkSync(miniSpecPath);
    if (fs.existsSync(resolve(miniTempDir, "app.json"))) fs.unlinkSync(resolve(miniTempDir, "app.json"));
    if (fs.existsSync(resolve(miniTempDir, "package.json"))) fs.unlinkSync(resolve(miniTempDir, "package.json"));
    fs.rmSync(resolve(miniTempDir, "miniprogram"), { recursive: true, force: true });
    fs.rmSync(miniTempDir, { recursive: true, force: true });
  });

  it("should collapse redundant wrappers in tree-shaking pass", async () => {
    const dslWithRedundant = [
      {
        id: "wrapper-parent",
        name: "Parent",
        type: "FRAME",
        width: 375,
        height: 64,
        fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
        children: [
          {
            id: "redundant-wrapper",
            name: "Group 1",
            type: "GROUP",
            width: 375,
            height: 64,
            paddingLeft: 0,
            paddingRight: 0,
            paddingTop: 0,
            paddingBottom: 0,
            children: [
              {
                id: "child-node",
                name: "Real Content",
                type: "TEXT",
                characters: "Hello World",
                style: {
                  fontSize: 14
                }
              }
            ]
          }
        ]
      }
    ];

    await ritsu_d2c_compile({
      dsl_sections: JSON.stringify(dslWithRedundant),
      root_metadata: mockRootMetadata
    });

    const spec = JSON.parse(readFileSync(specPath, "utf-8"));
    const redundantNode = spec.nodes.find((n: any) => n.id === "redundant-wrapper");
    expect(redundantNode).toBeUndefined();

    const childNode = spec.nodes.find((n: any) => n.id === "child-node");
    expect(childNode).toBeDefined();
    expect(childNode.parentId).toBe("wrapper-parent");

    const parentNode = spec.nodes.find((n: any) => n.id === "wrapper-parent");
    expect(parentNode.childrenIds).toContain("child-node");
  });

  it("should diff and compile variants/states from sibling naming conventions", async () => {
    const dslWithVariants = [
      {
        id: "btn-parent",
        name: "Parent",
        type: "FRAME",
        width: 375,
        height: 100,
        children: [
          {
            id: "btn-default",
            name: "Button/Default",
            type: "FRAME",
            width: 100,
            height: 40,
            fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
            children: [
              {
                id: "btn-text-default",
                name: "Label",
                type: "TEXT",
                characters: "Click Me"
              }
            ]
          },
          {
            id: "btn-hover",
            name: "Button/Hover",
            type: "FRAME",
            width: 100,
            height: 40,
            fills: [{ type: "SOLID", color: { r: 0, g: 1, b: 0, a: 1 } }],
            children: [
              {
                id: "btn-text-hover",
                name: "Label",
                type: "TEXT",
                characters: "Click Me"
              }
            ]
          }
        ]
      }
    ];

    await ritsu_d2c_compile({
      dsl_sections: JSON.stringify(dslWithVariants),
      root_metadata: mockRootMetadata
    });

    const spec = JSON.parse(readFileSync(specPath, "utf-8"));
    
    const baseNode = spec.nodes.find((n: any) => n.id === "btn-default");
    expect(baseNode).toBeDefined();
    expect(baseNode.name).toBe("Button");

    const hoverNode = spec.nodes.find((n: any) => n.id === "btn-hover");
    expect(hoverNode).toBeUndefined();

    expect(baseNode.variants).toBeDefined();
    expect(baseNode.variants.hover).toBeDefined();
    expect(baseNode.variants.hover.css["background-color"]).toContain("rgba(0, 255, 0, 1)");
  });

  it("should de-duplicate SVGs into sprites", async () => {
    const dslWithIcons = [
      {
        id: "container",
        name: "Container",
        type: "FRAME",
        width: 375,
        height: 100,
        children: [
          {
            id: "icon1",
            name: "icon/arrow-right",
            type: "PATH",
            width: 24,
            height: 24
          },
          {
            id: "icon2",
            name: "icon/arrow-right-dup",
            type: "PATH",
            width: 24,
            height: 24
          }
        ]
      }
    ];
    const svgsMap = {
      "icon/arrow-right|icon1": "<svg viewBox='0 0 24 24'><path d='M0 0h24v24H0z'/></svg>",
      "icon/arrow-right-dup|icon2": "<svg viewBox='0 0 24 24'><path d='M0 0h24v24H0z'/></svg>"
    };

    await ritsu_d2c_compile({
      dsl_sections: JSON.stringify(dslWithIcons),
      root_metadata: mockRootMetadata,
      svgs: svgsMap
    });

    const spec = JSON.parse(readFileSync(specPath, "utf-8"));
    
    expect(spec.environment.svgSprites).toBeDefined();
    const spriteIds = Object.keys(spec.environment.svgSprites);
    expect(spriteIds.length).toBe(1);

    const spriteId = spriteIds[0];
    expect(spec.environment.svgSprites[spriteId]).toContain("<symbol id=\"" + spriteId + "\"");

    const node1 = spec.nodes.find((n: any) => n.id === "icon1");
    const node2 = spec.nodes.find((n: any) => n.id === "icon2");
    expect(node1.attributes["data-mg-svg-sprite"]).toBe(spriteId);
    expect(node2.attributes["data-mg-svg-sprite"]).toBe(spriteId);
  });

  it("should detect partial components and adjust root CSS to be responsive", async () => {
    const partialMetadata = {
      id: "partial-root",
      name: "Button Component",
      type: "FRAME",
      width: 120,
      height: 40
    };
    const simpleDsl = [
      {
        id: "btn-text",
        name: "Label",
        type: "TEXT",
        characters: "Button"
      }
    ];

    await ritsu_d2c_compile({
      dsl_sections: JSON.stringify(simpleDsl),
      root_metadata: partialMetadata
    });

    const spec = JSON.parse(readFileSync(specPath, "utf-8"));
    
    expect(spec.environment.isPartialComponent).toBe(true);
    
    const rootNode = spec.nodes.find((n: any) => n.id === "partial-root");
    expect(rootNode.css["width"]).toBe("100%");
    expect(rootNode.css["max-width"]).toBeDefined();
    expect(rootNode.css["height"]).toBe("auto");
  });
});
