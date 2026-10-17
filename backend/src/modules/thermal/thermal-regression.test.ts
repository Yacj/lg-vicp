import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  calculateThermal,
  type CalcLayer,
  type ResolvedRules
} from "./thermal-calculator.js";

/**
 * 甲方样例回归入口：
 * - fixture 约定：fixtures/thermal-regression/*.json（mode + rules + layers + equivalentParams? + standardLimit? + expected）；
 * - 当前含甲方 Excel 两例（vicp-sheet-overall / vicp-sheet-layered）与两个最小自检样例；
 * - 断言规则：calculator 是确定性纯函数，同 fixture 每次运行结果必须与期望完全相等；
 * - 已证实但尚未修正的口径差异用 `knownGap` 标注：该 fixture 的产品整体热阻断言以
 *   expected-to-fail 方式运行。一旦实现修正，该用例会转为「意外通过」而失败，
 *   强制移除 knownGap —— 不允许静默放过。
 */

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/thermal-regression"
);

interface ThermalFixture {
  name: string;
  description?: string;
  mode: "EQUIVALENT" | "LAYERED";
  rules: ResolvedRules;
  layers: CalcLayer[];
  equivalentParams?: { conductivity: number; correctionFactor: number };
  standardLimit?: { limitKValue: number } | null;
  /** 已证实但需甲方确认/版本治理后才能修正的口径差异；存在时产品整体热阻断言按 expected-to-fail 运行 */
  knownGap?: string;
  expected: {
    valid: boolean;
    /** 墙体各层之和 ΣR（不含内外表面换热阻） */
    sumResistance?: number;
    productResistanceRounded: number | null;
    /** 真空芯材自身热阻（仅分层例给出，用于证明「芯材 R ≠ 产品整体 R」） */
    coreResistance?: number;
    totalResistanceRounded: number | null;
    kValueRounded: number | null;
    compliant: boolean | null;
  };
}

function loadFixtures(): Array<{ file: string; fixture: ThermalFixture }> {
  if (!exists(FIXTURES_DIR)) return [];
  return readdirSync(FIXTURES_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => ({ file, fixture: JSON.parse(readFileSync(path.join(FIXTURES_DIR, file), "utf-8")) as ThermalFixture }));
}

function exists(target: string): boolean {
  try {
    readdirSync(target);
    return true;
  } catch {
    return false;
  }
}

const fixtures = loadFixtures();

function run(fixture: ThermalFixture) {
  return calculateThermal({
    mode: fixture.mode,
    rules: fixture.rules,
    layers: fixture.layers,
    equivalentParams: fixture.equivalentParams,
    standardLimit: fixture.standardLimit ?? null
  });
}

describe("thermal-regression 甲方样例回归", () => {
  if (fixtures.length === 0) {
    it("fixtures/thermal-regression 目录为空：请放入甲方样例（输入+期望结果）", () => {
      expect(fixtures.length).toBeGreaterThan(0);
    });
    return;
  }

  for (const { file, fixture } of fixtures) {
    it(`${file}：${fixture.name} — ΣR / R₀ / K / 判定`, () => {
      const outcome = run(fixture);
      expect(outcome.valid).toBe(fixture.expected.valid);
      expect(outcome.totalResistanceRounded).toBe(fixture.expected.totalResistanceRounded);
      expect(outcome.kValueRounded).toBe(fixture.expected.kValueRounded);
      expect(outcome.compliant).toBe(fixture.expected.compliant);
      if (fixture.expected.sumResistance !== undefined) {
        // ΣR 必须按原值核对（至少 6 位有效小数），不靠 K 反推。
        expect(outcome.totalResistance! - fixture.rules.interiorSurfaceResistance - fixture.rules.exteriorSurfaceResistance)
          .toBeCloseTo(fixture.expected.sumResistance, 12);
      }
      // 确定性：同输入两次计算完全相等（快照可比对）
      expect(run(fixture)).toEqual(outcome);
    });

    if (fixture.expected.coreResistance !== undefined) {
      it(`${file}：芯材自身热阻与产品整体热阻是两个事实`, () => {
        const outcome = run(fixture);
        // 当前 productResistance 只累加 PRODUCT_LAYER，因此等于真空芯材热阻 4.8。
        expect(outcome.productResistance).toBeCloseTo(fixture.expected.coreResistance!, 12);
        expect(fixture.expected.productResistanceRounded).not.toBe(fixture.expected.coreResistance);
      });
    }

    const productResistanceAssertion = fixture.knownGap ? it.fails : it;
    productResistanceAssertion(`${file}：产品整体热阻（Excel 原值）`, () => {
      const outcome = run(fixture);
      expect(outcome.productResistanceRounded).toBe(fixture.expected.productResistanceRounded);
    });
  }
});
