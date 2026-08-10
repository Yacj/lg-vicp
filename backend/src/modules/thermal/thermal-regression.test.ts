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
 * - 当前无甲方样例，内置 basic-layered / basic-equivalent 两个最小自检样例；
 *   甲方提供样例后直接放入该目录（输入 + 期望结果）即可驱动回归，无需改测试代码；
 * - 断言规则：calculator 是确定性纯函数，同 fixture 每次运行结果必须与期望完全相等。
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
  expected: {
    valid: boolean;
    productResistanceRounded: number | null;
    totalResistanceRounded: number | null;
    kValueRounded: number | null;
    compliant: boolean | null;
  };
}

function loadFixtures(): Array<{ file: string; fixture: ThermalFixture }> {
  if (!exists(FIXTURES_DIR)) return [];
  return readdirSync(FIXTURES_DIR)
    .filter((file) => file.endsWith(".json"))
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

describe("thermal-regression 甲方样例回归", () => {
  if (fixtures.length === 0) {
    it("fixtures/thermal-regression 目录为空：请放入甲方样例（输入+期望结果）", () => {
      expect(fixtures.length).toBeGreaterThan(0);
    });
    return;
  }

  for (const { file, fixture } of fixtures) {
    it(`${file}：${fixture.name}`, () => {
      const outcome = calculateThermal({
        mode: fixture.mode,
        rules: fixture.rules,
        layers: fixture.layers,
        equivalentParams: fixture.equivalentParams,
        standardLimit: fixture.standardLimit ?? null
      });
      expect(outcome.valid).toBe(fixture.expected.valid);
      expect(outcome.productResistanceRounded).toBe(fixture.expected.productResistanceRounded);
      expect(outcome.totalResistanceRounded).toBe(fixture.expected.totalResistanceRounded);
      expect(outcome.kValueRounded).toBe(fixture.expected.kValueRounded);
      expect(outcome.compliant).toBe(fixture.expected.compliant);
      // 确定性：同输入两次计算完全相等（快照可比对）
      const again = calculateThermal({
        mode: fixture.mode,
        rules: fixture.rules,
        layers: fixture.layers,
        equivalentParams: fixture.equivalentParams,
        standardLimit: fixture.standardLimit ?? null
      });
      expect(again).toEqual(outcome);
    });
  }
});