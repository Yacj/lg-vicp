import { salesCases } from "./sales/index.js";
import { designCases } from "./design-institute/index.js";
import { semanticQueryCases } from "./semantic-query.js";
export const uatCases = [...salesCases, ...designCases, ...semanticQueryCases];
