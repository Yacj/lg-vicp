import "dotenv/config";
import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({generate:vi.fn()}));
vi.mock("ai",()=>({generateObject:mocks.generate}));
import {reviewReportAuthorization} from "./report-execution-review.js";
beforeEach(()=>vi.resetAllMocks());
it.each(["EXECUTE","PREPARE","UNCLEAR"] as const)("报告目标%s只核验完整原话，不接收方案状态或工程值",async operation=>{
 const message="测试完整操作授权语境";mocks.generate.mockResolvedValue({object:{operation,confidence:.94,evidence:message}});
 expect(await reviewReportAuthorization({} as any,message,new AbortController().signal)).toBe(operation);
 expect(mocks.generate.mock.calls[0][0].prompt).toBe(message);
 expect(mocks.generate.mock.calls[0][0].output).toBe("no-schema");
});
it.each(["partial-evidence","low-confidence","unexpected-field"])("报告复核%s不能扩大执行授权",async variant=>{
 const message="前后完整操作限制";mocks.generate.mockResolvedValue({object:{operation:"EXECUTE",confidence:variant==="low-confidence"?.89:.99,evidence:variant==="partial-evidence"?"操作":message,...(variant==="unexpected-field"?{snapshotId:"invented"}:{})}});
 const result=reviewReportAuthorization({} as any,message,new AbortController().signal);
 if(variant==="unexpected-field")await expect(result).rejects.toThrow();else expect(await result).toBe("UNCLEAR");
});
