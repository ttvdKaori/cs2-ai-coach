import { parseDemo } from "../src/parser.js";

const demoPath = process.argv[2];
if (!demoPath) {
  console.error("usage: mock-real-parser.mjs <demo.dem>");
  process.exit(2);
}

const parsed = parseDemo({
  id: process.env.CS2_DEMO_UPLOAD_ID || "upload_mock",
  originalName: process.env.CS2_DEMO_ORIGINAL_NAME || "mock.dem",
  size: Number(process.env.CS2_DEMO_SIZE || 1),
  sha256: process.env.CS2_DEMO_SHA256 || "mocksha"
});

parsed.parser = {
  name: "mock-real-parser",
  mode: "real-demo-parser-fixture",
  source: demoPath
};
parsed.match.id = "match_from_mock_real_parser";

process.stdout.write(`${JSON.stringify(parsed)}\n`);
