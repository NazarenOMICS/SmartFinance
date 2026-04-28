const { spawn } = require("child_process");
const path = require("path");

function runPaddleOcr(filePath, options = {}) {
  const python = process.env.PADDLEOCR_PYTHON || "python";
  const timeoutMs = Number(process.env.PADDLEOCR_TIMEOUT_MS || 45000);
  const workerPath = path.join(__dirname, "..", "ocr", "paddle_worker.py");
  const lang = options.lang || process.env.PADDLEOCR_LANG || "es";

  return new Promise((resolve) => {
    const child = spawn(python, [workerPath, filePath, "--lang", lang], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({
        ok: false,
        code: "ocr_engine_unavailable",
        error: `PaddleOCR timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf-8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf-8"); });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, code: "ocr_engine_unavailable", error: error.message });
    });
    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const lastJsonLine = stdout.trim().split(/\r?\n/).reverse().find(Boolean);
      try {
        const parsed = JSON.parse(lastJsonLine || "{}");
        resolve(parsed.ok === false ? parsed : normalizeOcrResult(parsed));
      } catch (_) {
        resolve({
          ok: false,
          code: "ocr_engine_unavailable",
          error: stderr.trim() || stdout.trim() || "PaddleOCR returned invalid output",
        });
      }
    });
  });
}

function normalizeOcrResult(result) {
  const blocks = Array.isArray(result.blocks) ? result.blocks : [];
  return {
    ok: true,
    provider: result.provider || "paddleocr",
    language: result.language || "es",
    raw_text: String(result.raw_text || blocks.map((block) => block.text).join("\n")).trim(),
    blocks: blocks.map((block) => ({
      text: String(block.text || "").trim(),
      bbox: block.bbox || null,
      confidence: Number(block.confidence || 0),
    })).filter((block) => block.text),
    confidence: Number(result.confidence || 0),
  };
}

module.exports = {
  runPaddleOcr,
};
