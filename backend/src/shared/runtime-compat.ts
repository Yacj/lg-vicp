type MathWithSumPrecise = Math & {
  sumPrecise?: (numbers: Iterable<number>) => number;
};

function sumWithCompensation(numbers: Iterable<number>): number {
  const partials: number[] = [];
  let infinite: number | undefined;

  for (const value of numbers) {
    if (typeof value !== "number") throw new TypeError("Math.sumPrecise 的元素必须是数字");
    if (Number.isNaN(value)) return Number.NaN;
    if (!Number.isFinite(value)) {
      if (infinite !== undefined && infinite !== value) return Number.NaN;
      infinite = value;
      continue;
    }

    let sum = value;
    let writeIndex = 0;
    for (let partial of partials) {
      if (Math.abs(sum) < Math.abs(partial)) [sum, partial] = [partial, sum];
      const high = sum + partial;
      const low = partial - (high - sum);
      if (low !== 0) partials[writeIndex++] = low;
      sum = high;
    }
    partials.length = writeIndex;
    if (sum !== 0) partials.push(sum);
  }

  if (infinite !== undefined) return infinite;
  return partials.reduce((total, partial) => total + partial, 0);
}

export function installPdfRuntimeCompat(): void {
  const math = Math as MathWithSumPrecise;
  if (typeof math.sumPrecise !== "function") {
    Object.defineProperty(math, "sumPrecise", {
      configurable: true,
      writable: true,
      value: sumWithCompensation
    });
  }
}

/**
 * LibreOffice / 复杂 PDF 在 Node Worker 里渲染时，pdf.js 会用到浏览器 Path2D 等 API；
 * @napi-rs/canvas 已提供同名实现，挂到 globalThis 即可。
 * 仅页面图渲染线程需要；纯文本提取不必加载原生 canvas。
 */
export async function installPdfCanvasGlobals(): Promise<void> {
  const canvas = await import("@napi-rs/canvas");
  const globals = globalThis as typeof globalThis & Record<string, unknown>;
  const bindings: Array<[string, unknown]> = [
    ["Path2D", canvas.Path2D],
    ["DOMMatrix", canvas.DOMMatrix],
    ["DOMPoint", canvas.DOMPoint],
    ["DOMRect", canvas.DOMRect],
    ["ImageData", canvas.ImageData]
  ];
  for (const [name, value] of bindings) {
    if (typeof globals[name] === "undefined" && typeof value !== "undefined") {
      Object.defineProperty(globals, name, {
        configurable: true,
        writable: true,
        value
      });
    }
  }
}