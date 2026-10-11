import {
  getPrompt,
  PROMPT_KEYS,
  PROMPT_REGISTRY,
} from "@/app/lib/ai/prompts";
import PromptEditor from "@/app/ui/prompt-editor";

export const dynamic = "force-dynamic";

export default async function PromptsPage() {
  const prompts = await Promise.all(
    Object.values(PROMPT_KEYS).map(async (key) => {
      const definition = PROMPT_REGISTRY[key];
      const template = await getPrompt(key);

      return {
        key,
        label: definition.label,
        description: definition.description,
        variables: [...definition.variables],
        template,
      };
    }),
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-2xl tracking-[-0.01em] text-foreground">
          Prompts
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Edit the templates used for generation, review, and Search Console
          analysis. Placeholders in double braces are replaced with live data at
          run time. Saved versions are kept in history so you can roll back.
        </p>
      </div>

      <PromptEditor prompts={prompts} />
    </div>
  );
}
