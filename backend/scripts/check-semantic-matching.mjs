import { parse } from "@babel/parser";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
export const lexicalMethods = new Set(["includes", "startsWith", "endsWith", "indexOf", "match", "matchAll", "test", "exec", "replace", "split", "has"]);
export const fingerprint = (code) => createHash("sha256").update(code.replaceAll("\r\n", "\n")).digest("hex");
/** 解析AST，不将grep当作语义审查。只定位可疑表达式；白名单以精确节点指纹绑定。 */
export function inspectMatching(source, file = "route.ts") {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
  const nodes = [];
  function visit(node) {
    let kind;
    if (node.type === "RegExpLiteral") kind = "REGEXP";
    if ((node.type === "NewExpression" || node.type === "CallExpression") && (node.callee?.name === "RegExp" || node.callee?.object?.name === "globalThis" && node.callee?.property?.name === "RegExp")) kind = "REGEXP_CONSTRUCTOR";
    if ((node.type === "CallExpression" || node.type === "OptionalCallExpression") && (node.callee?.type === "MemberExpression" || node.callee?.type === "OptionalMemberExpression")
      && lexicalMethods.has(node.callee.property.name ?? node.callee.property.value)) kind = "LEXICAL_CALL";
    if (node.type === "BinaryExpression" && [node.left, node.right].some(value => value.type === "StringLiteral" && [...value.value].some(char => char.charCodeAt(0) > 127))) kind = "NATURAL_LITERAL_BRANCH";
    if (kind) { const code = source.slice(node.start, node.end); nodes.push({ file, line: node.loc.start.line, kind, code, fingerprint: fingerprint(code) }); }
    for (const [key, value] of Object.entries(node)) {
      if (key === "comments" || key === "tokens" || key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
      if (Array.isArray(value)) value.forEach(child => { if (child?.type) visit(child); });
      else if (value?.type) visit(value);
    }
  }
  visit(ast);
  return nodes;
}
export function checkMatching(nodes, exemptions) {
  const failures = [];
  const allowedCategories = new Set(["ENGINEERING_EXTRACTION", "FORMAT", "EVIDENCE", "FACT_VALIDATION", "ENUM_MEMBERSHIP", "CLOSED_COMMAND", "CLOSED_GREETING"]);
  for (const node of nodes) {
    const entry = exemptions.find(rule => rule.file === node.file && rule.fingerprint === node.fingerprint);
    if (!entry || !entry.ruleId || !entry.reason || !entry.tests?.length || !allowedCategories.has(entry.category)) failures.push(node);
  }
  return failures;
}
export function matchingFiles(root = process.cwd()) {
  return readdirSync(resolve(root, "src/modules/ai")).filter(file => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith(".fixture.ts")
    && (file.startsWith("ai-domain-") || file.startsWith("solution-advice") || file.startsWith("solution-action-semantic") || file === "ai-capability-router.ts"))
    .map(file => `src/modules/ai/${file}`).concat(["src/shared/lambda-field.ts", "src/modules/ai/product-parameter-query.ts"]);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(readFileSync("scripts/semantic-matching-exemptions.json", "utf8"));
  const nodes = matchingFiles().flatMap(file => inspectMatching(readFileSync(file, "utf8"), file));
  const failures = checkMatching(nodes, manifest.rules);
  for (const rule of manifest.rules) for (const test of rule.tests) if (!existsSync(test)) failures.push({ file: rule.file, line: 0, kind: "MISSING_COUNTEREXAMPLE_TEST" });
  if (failures.length) { for (const failure of failures) console.error(`${failure.file}:${failure.line} ${failure.kind}：匹配表达式缺少精确白名单证据，禁止合并`); process.exitCode = 1; }
  else console.log(`语义匹配AST检查通过：${matchingFiles().length}个关键文件，${nodes.length}个白名单表达式；开放意图规则禁止。`);
}
