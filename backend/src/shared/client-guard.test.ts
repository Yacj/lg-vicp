import { describe, expect, it } from "vitest";
import { assertClient } from "./client-guard.js";

function requestWithClient(clientType: "B_ADMIN" | "C_APP" | "PC_AI") {
  return {
    currentUser: { id: "user-1", role: "NORMAL_USER", channelType: null, clientType }
  } as never;
}

describe("客户端权限隔离", () => {
  it("允许匹配的客户端访问", () => {
    expect(() => assertClient(requestWithClient("B_ADMIN"), ["B_ADMIN"])).not.toThrow();
  });

  it("拒绝跨客户端访问", () => {
    expect(() => assertClient(requestWithClient("C_APP"), ["B_ADMIN"])).toThrow("当前登录端无权访问此接口");
  });
});
