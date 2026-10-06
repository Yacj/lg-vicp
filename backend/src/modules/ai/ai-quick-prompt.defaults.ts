/**
 * 平台预置快捷提问。content 必须是用户会说的自然问题，不能包含系统指令。
 * seed 对存量只更新仍带系统味的旧文案，不覆盖管理员已改写的内容。
 */
import {
  AI_QUICK_PROMPT_ACTION_TYPES,
  AI_QUICK_PROMPT_POSITIONS
} from "../../shared/constants.js";

export type DefaultQuickPromptSeed = {
  title: string;
  description: string;
  content: string;
  icon: "book" | "project" | "material" | "standard";
  position: typeof AI_QUICK_PROMPT_POSITIONS[keyof typeof AI_QUICK_PROMPT_POSITIONS];
  sortOrder: number;
  enabled: true;
  actionType: typeof AI_QUICK_PROMPT_ACTION_TYPES[keyof typeof AI_QUICK_PROMPT_ACTION_TYPES];
};

export const DEFAULT_QUICK_PROMPTS: DefaultQuickPromptSeed[] = [
  {
    title: "查询图集",
    description: "查询相关图集做法和出处",
    content: "帮我查一下和当前问题相关的图集做法，并告诉我出处。",
    icon: "book",
    position: AI_QUICK_PROMPT_POSITIONS.AI_HOME,
    sortOrder: 10,
    enabled: true,
    actionType: AI_QUICK_PROMPT_ACTION_TYPES.AUTO
  },
  {
    title: "分析当前项目",
    description: "结合当前项目看看需要注意什么",
    content: "结合当前项目，帮我看看这个问题需要注意什么。",
    icon: "project",
    position: AI_QUICK_PROMPT_POSITIONS.AI_HOME,
    sortOrder: 20,
    enabled: true,
    actionType: AI_QUICK_PROMPT_ACTION_TYPES.AUTO
  },
  {
    title: "匹配保温方案",
    description: "按当前条件找可参考的保温方案",
    content: "根据当前条件，帮我找几个可以参考的保温方案，并附上依据。",
    icon: "material",
    position: AI_QUICK_PROMPT_POSITIONS.AI_HOME,
    sortOrder: 30,
    enabled: true,
    actionType: AI_QUICK_PROMPT_ACTION_TYPES.AUTO
  },
  {
    title: "查询节能标准",
    description: "查询相关节能标准和出处",
    content: "帮我查一下和当前问题相关的节能标准，告诉我关键要求和出处。",
    icon: "standard",
    position: AI_QUICK_PROMPT_POSITIONS.AI_HOME,
    sortOrder: 40,
    enabled: true,
    actionType: AI_QUICK_PROMPT_ACTION_TYPES.AUTO
  }
];

/** 历史 seed 文案。匹配到这些内容时才允许被默认文案覆盖。 */
export const LEGACY_QUICK_PROMPT_CONTENTS = [
  "请根据当前已发布的知识资料，帮助我查询与问题相关的图集内容，并给出对应章节、页码和原文来源。",
  "请结合当前项目的真实资料，分析与我问题相关的项目情况和注意事项。如果会话尚未关联项目，请明确提示我先选择项目。",
  "请根据当前已发布的知识资料和构造做法，帮助我匹配合适的保温方案，并给出对应章节、页码和原文来源。",
  "请根据当前已发布的知识资料，帮助我查询相关节能标准和技术要求，并给出对应章节、页码和原文来源。找不到可靠依据时请明确说明，不要编造标准号或条文。"
] as const;

const SYSTEM_WORDING_PATTERN = /当前已发布|不要编造|找不到可靠依据|给出对应章节[、,，]页码和原文来源|如果会话尚未关联项目/;

export function isLegacySystemWordingQuickPrompt(content: string): boolean {
  const value = content.trim();
  if (!value) return false;
  if ((LEGACY_QUICK_PROMPT_CONTENTS as readonly string[]).includes(value)) return true;
  return SYSTEM_WORDING_PATTERN.test(value);
}
