import { describe, it, expect } from "vitest";
import { ritsu_exec } from "../../src/handlers/exec.js";

describe("ritsu_exec", () => {
  it("should block shell metacharacters", async () => {
    const dangerousCommands = [
      "ls | grep test",
      "cat file && rm file",
      "echo $(whoami)",
      "ls > output.txt",
      "cat << EOF",
    ];

    for (const command of dangerousCommands) {
      const result = await ritsu_exec({ command });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("shell metacharacter blocked");
    }
  });

  it("should block unauthorized binaries", async () => {
    const unauthorized = ["rm", "docker", "kubectl", "sudo", "apt-get"];

    for (const binary of unauthorized) {
      const result = await ritsu_exec({ command: `${binary} --version` });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("command blocked");
    }
  });

  it("should block dangerous arguments", async () => {
    const dangerous = [
      "node -e 'console.log(1)'",
      "python -c 'print(1)'",
      "git push origin main --force",
    ];

    for (const command of dangerous) {
      const result = await ritsu_exec({ command });
      expect(result.isError).toBe(true);
      // Could be binary block or argument block depending on platform/setup
      const msg = result.content[0].text;
      expect(msg).toMatch(/blocked/);
    }
  });

  it("should execute allowed simple commands", async () => {
    const result = await ritsu_exec({ command: "echo hello-ritsu" });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.ok).toBe(true);
    expect(data.output).toBe("hello-ritsu");
  });
});
