/**
 * Build script: Obfuscate + Minify JS files
 * Run: node build.js
 * Output: build/js/*.js (obfuscated & minified)
 */

const fs = require("fs");
const path = require("path");
const JavaScriptObfuscator = require("javascript-obfuscator");
const { minify } = require("terser");

const SRC_DIR = path.join(__dirname, "js");
const OUT_DIR = path.join(__dirname, "build", "js");

// Files to process
const FILES = ["firebase-config.js", "app.js"];

// Obfuscator options — balanced between protection and performance
const obfuscatorOptions = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,
  debugProtection: true,
  debugProtectionInterval: 2000,
  disableConsoleOutput: false,
  identifierNamesGenerator: "hexadecimal",
  log: false,
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 5,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ["base64"],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 4,
  stringArrayWrappersType: "function",
  stringArrayThreshold: 0.75,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
};

async function build() {
  // Ensure output directory exists
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const file of FILES) {
    const srcPath = path.join(SRC_DIR, file);
    const outPath = path.join(OUT_DIR, file);

    if (!fs.existsSync(srcPath)) {
      console.warn(`⚠ Skip: ${srcPath} not found`);
      continue;
    }

    console.log(`Processing ${file}...`);
    let code = fs.readFileSync(srcPath, "utf-8");

    // Step 1: Obfuscate
    const obfuscated = JavaScriptObfuscator.obfuscate(code, obfuscatorOptions);
    let result = obfuscated.getObfuscatedCode();

    // Step 2: Minify with terser
    const minified = await minify(result, {
      compress: { drop_console: false, passes: 2 },
      mangle: true,
      format: { comments: false },
    });

    fs.writeFileSync(outPath, minified.code || result, "utf-8");
    const origSize = Buffer.byteLength(code, "utf-8");
    const finalSize = Buffer.byteLength(minified.code || result, "utf-8");
    console.log(
      `  ✓ ${file}: ${(origSize / 1024).toFixed(1)}KB → ${(finalSize / 1024).toFixed(1)}KB (obfuscated + minified)`
    );
  }

  console.log(`\n✅ Build complete → ${OUT_DIR}`);
  console.log(
    "Để dùng bản bảo mật, đổi script src trong index.html từ js/ sang build/js/"
  );
}

build().catch((e) => {
  console.error("Build failed:", e);
  process.exit(1);
});
