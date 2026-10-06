import { afterEach, describe, expect, it } from "vitest";
import { Path2D } from "@napi-rs/canvas";
import { installPdfCanvasGlobals, installPdfRuntimeCompat } from "./runtime-compat.js";

const originalDescriptor = Object.getOwnPropertyDescriptor(Math, "sumPrecise");
const canvasGlobalNames = ["Path2D", "DOMMatrix", "DOMPoint", "DOMRect", "ImageData"] as const;
const originalCanvasGlobals = new Map(
  canvasGlobalNames.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name)
  ])
);

afterEach(() => {
  if (originalDescriptor) Object.defineProperty(Math, "sumPrecise", originalDescriptor);
  else Reflect.deleteProperty(Math, "sumPrecise");
  for (const name of canvasGlobalNames) {
    const descriptor = originalCanvasGlobals.get(name);
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
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

  it("补齐 Path2D 等 canvas 全局，供 LibreOffice PDF 渲染", async () => {
    for (const name of canvasGlobalNames) Reflect.deleteProperty(globalThis, name);

    await installPdfCanvasGlobals();

    expect(globalThis.Path2D).toBe(Path2D);
    expect(typeof globalThis.DOMMatrix).toBe("function");
    expect(typeof globalThis.ImageData).toBe("function");
  });
});