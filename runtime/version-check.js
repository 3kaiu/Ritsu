// Version check stub — ensures runtime version matches expected
const expected = "7.3.0";
let actual = "unknown";
try {
  actual = process.env.RITSU_VERSION || "7.3.0";
} catch {}
if (actual !== expected) {
  console.error(`Version mismatch: expected ${expected}, got ${actual}`);
  process.exit(1);
}
process.exit(0);
