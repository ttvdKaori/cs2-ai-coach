import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseUploadedDemo, validateParsedDemo } from "../src/parserRunner.js";
import { parseDemo } from "../src/parser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const upload = {
  id: "upload_abcdef0123456789",
  originalName: "minimal.dem",
  size: 17,
  sha256: "8b646018a096d1f0f5e53b2a73e92378dfbf16c03fa8d654890f5f02d98f2555",
  storedPath: path.join(root, "test", "fixtures", "minimal.dem")
};

test("parseUploadedDemo falls back when no real parser is configured", async () => {
  const parsed = await parseUploadedDemo(upload, { parserBin: "" });
  assert.equal(parsed.parser.mode, "synthetic-fallback");
  assert.equal(parsed.parser.fallback, true);
  assert.match(parsed.parser.fallbackReason, /not configured/);
});

test("parseUploadedDemo uses configured external parser when it emits valid contract JSON", async () => {
  const parsed = await parseUploadedDemo(upload, {
    parserBin: path.join(root, "tools", "mock-real-parser.sh")
  });
  assert.equal(parsed.parser.name, "mock-real-parser", JSON.stringify(parsed.parser));
  assert.equal(parsed.parser.mode, "real-demo-parser");
  assert.equal(parsed.parser.fallback, false);
  assert.equal(parsed.match.id, "match_from_mock_real_parser");
});

test("parseUploadedDemo can require the real parser and fail on invalid output", async () => {
  await assert.rejects(
    () =>
      parseUploadedDemo(upload, {
        parserBin: path.join(root, "tools", "mock-invalid-parser.mjs"),
        requireRealParser: true
      }),
    /Real demo parser failed/
  );
});

test("validateParsedDemo accepts the current report contract", () => {
  const parsed = parseDemo(upload);
  assert.doesNotThrow(() => validateParsedDemo(parsed));
});
