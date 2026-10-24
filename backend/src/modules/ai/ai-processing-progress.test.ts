import { expect, it, vi } from "vitest";
import { createProcessingProgress, processingSources } from "./ai-processing-progress.js";

it("过程只展示实际阶段和来源名称，排除内部入参、正文、链接及物理页号", () => {
  const source = { title: "热工表", pageLabel: "A7", physicalPageNumber: 99, documentId: "private-id",
    query: "secret", reasoning_content: "secret", url: "https://secret", matchedText: "secret" };
  expect(processingSources([source, source, null, { title: "" }, { title: "说明", pageNumber: 17 }]))
    .toEqual([{ title: "热工表", pageLabel: "A7" }, { title: "说明" }]);
});

it("只有已开始步骤才能完成；中断不能伪装查询成功", () => {
  const output: string[] = [];
  const reply = { raw: { write: (text: string) => output.push(text) } } as never;
  const progress = createProcessingProgress(reply);
  progress.complete("knowledge");
  expect(output).toHaveLength(0);
  progress.start("knowledge");
  progress.sources([]);
  expect(output).toHaveLength(1);
  progress.interrupt("stopped");
  progress.complete("knowledge");
  const events = output.map(text => JSON.parse(text.split("data: ")[1]!));
  expect(events.map(event => event.status)).toEqual(["active", "stopped"]);
  expect(output.join("")).not.toContain("已找到");
});

it("断开的响应不继续写进度", () => {
  const write = vi.fn();
  const progress = createProcessingProgress({ raw: { write, destroyed: true } } as never);
  progress.start("understanding");
  expect(write).not.toHaveBeenCalled();
});
