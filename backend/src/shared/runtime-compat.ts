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
  if (typeof math.sumPrecise === "function") return;

  Object.defineProperty(math, "sumPrecise", {
    configurable: true,
    writable: true,
    value: sumWithCompensation
  });
}