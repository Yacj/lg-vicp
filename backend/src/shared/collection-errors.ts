import { AppError } from "./errors.js";

export const COLLECTION_ERROR_CODES = {
  COLLECTION_TASK_NOT_CONFIRMABLE: "COLLECTION_TASK_NOT_CONFIRMABLE",
  COLLECTION_TASK_ALREADY_IMPORTED: "COLLECTION_TASK_ALREADY_IMPORTED",
  COLLECTION_RESULT_MISSING: "COLLECTION_RESULT_MISSING",
  COLLECTION_SOURCE_DISABLED: "COLLECTION_SOURCE_DISABLED",
  COLLECTION_INFLIGHT: "COLLECTION_INFLIGHT"
} as const;

export type CollectionErrorCode = (typeof COLLECTION_ERROR_CODES)[keyof typeof COLLECTION_ERROR_CODES];

const SPECS: Record<CollectionErrorCode, { statusCode: number; message: string }> = {
  COLLECTION_TASK_NOT_CONFIRMABLE: { statusCode: 400, message: "当前采集任务不在待确认状态，不能导入知识库" },
  COLLECTION_TASK_ALREADY_IMPORTED: { statusCode: 409, message: "该采集任务已经导入知识库，不能重复入库" },
  COLLECTION_RESULT_MISSING: { statusCode: 400, message: "采集任务没有可用结果文件，不能导入知识库" },
  COLLECTION_SOURCE_DISABLED: { statusCode: 400, message: "采集源已停用" },
  COLLECTION_INFLIGHT: { statusCode: 409, message: "该采集源已有进行中的任务，请等待完成后再触发" }
};

export class CollectionError extends AppError {
  constructor(code: CollectionErrorCode, message?: string) {
    const spec = SPECS[code];
    super(code, message ?? spec.message, spec.statusCode, { errorCode: code });
  }
}
