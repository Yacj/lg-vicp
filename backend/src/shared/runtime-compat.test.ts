import { afterEach, describe, expect, it } from "vitest";
import { installPdfRuntimeCompat } from "./runtime-compat.js";

const originalDescriptor = Object.getOwnPropertyDescriptor(Math, "sumPrecise");

afterEach(() => {
  if (originalDescriptor) Object.defineProperty(Math, "sumPrecise", originalDescriptor);
  else Reflect.deleteProperty(Math, "sumPrecise");
});

describe("PDF 运行时兼容层", () => {
  it("补齐 Math.sumPrecise 并保留低位精度", () => {
    Reflect.deleteProperty(Math, "sumPrecise");

    installPdfRuntimeCompat();

    expect(Math.sumPrecise?.([1e16, 1, -1e16])).toBe(1);
    expect(Math.sumPrecise?.([0.1, 0.2, 0.3])).toBeCloseTo(0.6, 15);
  });

  it("不覆盖运行时原生实现", () => {
    const nativeImplementation = () => 42;
    Object.defineProperty(Math, "sumPrecise", {
      configurable: true,
      writable: true,
      value: nativeImplementation
    });

    installPdfRuntimeCompat();

    expect(Math.sumPrecise).toBe(nativeImplementation);
  });
});