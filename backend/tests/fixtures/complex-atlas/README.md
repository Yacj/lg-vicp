# 复杂热工图集的人工源图基线

三份JSON仅为人工源图基线（`provenance=MANUAL_SOURCE_BASELINE`），不是修复后真实Vision输出，更不是已确认/已发布业务资料。源PNG未改动，身份以各文件的imageSha256绑定，原图及阶段0真实响应路径见 `docs/ai/complex-atlas-three-clients-audit.md`。

保留全部38个厚度档位及原表R/K，不用公式校正。材料/芯层逐档热阻在layerValues，完整产品热阻无独立证据所以为null。屋面无印刷构造编号，保持null；源图防水等级字形不清，未把用户I级基线擅自当作视觉事实。模型第一轮遗漏的屋面基层在此由可见的120mm钢筋混凝土楼板人工读回；材料层号按右侧表而不是数组序号表示。

真实模型输出、工程证据检查后的结果与逐项比对由 `scripts/verify-complex-atlas-recognition.ts` 另行保存，禁止覆盖这些基线来迎合模型输出。夹具不写数据库、队列或对象存储。
