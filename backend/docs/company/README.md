# 企业信息（普通业务）

普通业务只维护一份企业展示档案，供 App/C 端关于我们、报告封面与页眉页脚、平台企业展示使用。

**不是**企业档案、CRM、工商信息库或资质审批/年审系统。

## 普通数据

```ts
interface CompanyProfile {
  id: string | null
  name: string
  shortName?: string | null
  logoFileId?: string | null
  description?: string | null
  website?: string | null
  qualifications: CompanyQualification[]
  updatedAt: string | null
}

interface CompanyQualification {
  id: string
  name: string
  fileId: string | null
  certificateNo?: string | null
  expireDate?: string | null
  sortOrder?: number
}
```

Logo / 资质附件只存 File Center `fileId`。Logo：PNG/JPEG/SVG；资质：图片或 PDF。

## API

前缀 `/api/v1/platform/company`，标签 `B端 / 平台 / 企业信息`，先 JWT + `B_ADMIN`，再按权限码。

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| GET | `/profile` | `system:md:enterprise:list` |
| PUT | `/profile` | `system:md:enterprise:edit` |
| GET | `/qualifications` | `system:md:enterprise:list` |
| POST | `/qualifications` | `system:md:enterprise:add` |
| PUT | `/qualifications/:id` | `system:md:enterprise:edit` |
| DELETE | `/qualifications/:id` | `system:md:enterprise:remove` |

PUT body 只接受 `name` / `shortName` / `logoFileId` / `description` / `website`。保存后即可被 About 与新生成报告读取，不走审核。

C 端：`GET /api/v1/company/about`（登录即可）。只返回 `name/shortName/logo/description/website/qualifications`。

兼容旧路径：`GET /api/v1/client/content/enterprise-profile`（`C_APP`/`PC_AI`），同源数据，保留 `intro`/`logoUrl` 别名。

旧主数据审核接口 `/api/v1/platform/masterdata/enterprise-*` 仍可用，普通 B 端不再使用。

## 历史字段

`enterprise_profiles` / `enterprise_certificates` 表不删列。地址、电话、邮箱、证据、审核状态等仍保留；普通 API 不强制、不返回。资质新增 `sort_order`。

## 报告

新生成报告的封面/页眉 Logo 与企业介绍章节优先读 CompanyProfile，在快照中冻结。`report_settings` 不维护第二套企业名称/Logo；`companyLogoFileId` 为只读派生。历史报告快照不改写。
