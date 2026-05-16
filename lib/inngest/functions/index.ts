import { declarativeActionFunctions } from "../declarative-actions.generated";
import { testEcho } from "./test-echo";

export const functions = [testEcho, ...declarativeActionFunctions] as const;
