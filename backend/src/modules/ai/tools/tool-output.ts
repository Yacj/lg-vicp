/**
 * Agent Tool 返回给模型的标准载荷。不把数据库 Row 或超大原始结果直接交给 LLM。
 */
export type ToolOkOutput<T> = {
  ok: true;
  data: T;
  summary?: string;
  sources?: unknown[];
};

export type ToolErrorOutput = {
  ok: false;
  code: string;
  message: string;
  recoverable: boolean;
};

export type ToolOutput<T> = ToolOkOutput<T> | ToolErrorOutput;

export function toolOk<T>(data: T, extra?: { summary?: string; sources?: unknown[] }): ToolOkOutput<T> {
  return {
    ok: true,
    data,
    ...(extra?.summary ? { summary: extra.summary } : {}),
    ...(extra?.sources ? { sources: extra.sources } : {})
  };
}

export function toolError(input: {
  code: string;
  message: string;
  recoverable?: boolean;
}): ToolErrorOutput {
  return {
    ok: false,
    code: input.code,
    message: input.message,
    recoverable: input.recoverable ?? true
  };
}
