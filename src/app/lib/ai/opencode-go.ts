export type {
  ChatMessage,
  ModelCallResult as ChatCompletionResult,
} from "./providers/types";
export type { ReasoningEffort } from "./models";

function repairJson(source: string): string {
  let inString = false;
  let escaped = false;
  let output = "";

  for (const char of source) {
    const code = char.charCodeAt(0);

    if (inString) {
      if (escaped) {
        const validEscape = char === '"' || char === "\\" || char === "/" || char === "b" || char === "f" || char === "n" || char === "r" || char === "t" || char === "u";
        output += validEscape ? char : `\\${char}`;
        escaped = false;
        continue;
      }

      if (char === "\\") {
        output += char;
        escaped = true;
        continue;
      }

      if (char === '"') {
        output += char;
        inString = false;
        continue;
      }

      if (code < 0x20) {
        if (char === "\n") output += "\\n";
        else if (char === "\r") output += "\\r";
        else if (char === "\t") output += "\\t";
        else output += `\\u${code.toString(16).padStart(4, "0")}`;
        continue;
      }

      output += char;
      continue;
    }

    if (char === '"') {
      inString = true;
    }

    output += char;
  }

  return output;
}

export function extractJsonObject(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1] : raw;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model response did not contain a JSON object");
  }

  const candidate = source.slice(start, end + 1);

  try {
    return JSON.parse(candidate);
  } catch {
    return JSON.parse(repairJson(candidate));
  }
}
