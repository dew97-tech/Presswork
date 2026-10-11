import { z } from "zod";
import { getSetting, setSetting } from "@/app/lib/settings";
import {
  DEFAULT_ANALYSIS_PROMPT,
  ANALYSIS_VARIABLES,
} from "./analysis-prompt";
import {
  DEFAULT_GENERATION_PROMPT,
  GENERATION_VARIABLES,
} from "./blog-prompt";
import type { ChatMessage } from "./opencode-go";
import { DEFAULT_REVIEW_PROMPT, REVIEW_VARIABLES } from "./review-prompt";

export const PROMPT_KEYS = {
  generation: "prompts.generation",
  review: "prompts.review",
  analysis: "prompts.searchAnalysis",
} as const;

export type PromptKey = (typeof PROMPT_KEYS)[keyof typeof PROMPT_KEYS];

export const promptVersionSchema = z.object({
  version: z.number().int().min(0),
  system: z.string().min(1),
  user: z.string().min(1),
  savedAt: z.string(),
});

export const promptTemplateSchema = z.object({
  system: z.string().min(50),
  user: z.string().min(50),
  version: z.number().int().min(0),
  updatedAt: z.string(),
  history: z.array(promptVersionSchema).max(10),
});

export type PromptTemplate = z.infer<typeof promptTemplateSchema>;
export type PromptVersion = z.infer<typeof promptVersionSchema>;

export interface PromptDefinition {
  key: PromptKey;
  label: string;
  description: string;
  variables: readonly string[];
  defaults: { system: string; user: string };
}

export const PROMPT_REGISTRY: Record<PromptKey, PromptDefinition> = {
  [PROMPT_KEYS.generation]: {
    key: PROMPT_KEYS.generation,
    label: "Generation",
    description:
      "Writes new draft articles from trend signals, keywords, and Search Console demand.",
    variables: GENERATION_VARIABLES,
    defaults: DEFAULT_GENERATION_PROMPT,
  },
  [PROMPT_KEYS.review]: {
    key: PROMPT_KEYS.review,
    label: "Review",
    description:
      "Audits a finished article for accuracy, code, SEO, and structure, and proposes corrections.",
    variables: REVIEW_VARIABLES,
    defaults: DEFAULT_REVIEW_PROMPT,
  },
  [PROMPT_KEYS.analysis]: {
    key: PROMPT_KEYS.analysis,
    label: "Search analysis",
    description:
      "Turns Search Console data into prioritized SEO recommendations.",
    variables: ANALYSIS_VARIABLES,
    defaults: DEFAULT_ANALYSIS_PROMPT,
  },
};

export function getPromptDefinition(key: string): PromptDefinition | undefined {
  return (PROMPT_REGISTRY as Record<string, PromptDefinition>)[key];
}

export function defaultPromptTemplate(definition: PromptDefinition): PromptTemplate {
  return {
    system: definition.defaults.system,
    user: definition.defaults.user,
    version: 0,
    updatedAt: "",
    history: [],
  };
}

export async function getPrompt(key: PromptKey): Promise<PromptTemplate> {
  return getSetting(
    key,
    promptTemplateSchema,
    defaultPromptTemplate(PROMPT_REGISTRY[key]),
  );
}

const VARIABLE_PATTERN = /\{\{([a-zA-Z0-9_]+)\}\}/g;

export function findTemplateVariables(template: string): string[] {
  return Array.from(template.matchAll(VARIABLE_PATTERN), (match) => match[1]);
}

export function unknownTemplateVariables(
  definition: PromptDefinition,
  template: { system: string; user: string },
): string[] {
  const allowed = new Set(definition.variables);
  const found = new Set([
    ...findTemplateVariables(template.system),
    ...findTemplateVariables(template.user),
  ]);

  return Array.from(found).filter((variable) => !allowed.has(variable));
}

export function renderPrompt(
  definition: PromptDefinition,
  template: PromptTemplate,
  context: Record<string, string>,
): ChatMessage[] {
  const unknown = unknownTemplateVariables(definition, template);
  if (unknown.length > 0) {
    throw new Error(
      `Unknown prompt variable ${unknown
        .map((variable) => `"${variable}"`)
        .join(", ")} in ${definition.key}`,
    );
  }

  const render = (text: string) =>
    text.replace(VARIABLE_PATTERN, (_match, name: string) => context[name] ?? "");

  return [
    { role: "system", content: render(template.system) },
    { role: "user", content: render(template.user) },
  ];
}

export async function savePromptTemplate(
  key: PromptKey,
  input: { system: string; user: string },
): Promise<PromptTemplate> {
  const current = await getPrompt(key);

  const historyEntry: PromptVersion = {
    version: current.version,
    system: current.system,
    user: current.user,
    savedAt: current.updatedAt,
  };

  const template: PromptTemplate = {
    system: input.system,
    user: input.user,
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
    history: [historyEntry, ...current.history].slice(0, 10),
  };

  await setSetting(key, template);
  return template;
}
