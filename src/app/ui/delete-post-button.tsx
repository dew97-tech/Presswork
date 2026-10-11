"use client";

import { deletePost } from "@/app/lib/admin-actions";
import { useToast } from "@/components/ui/toast";
import { Trash } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";

export default function DeletePostButton({ postId }: { postId: string }) {
  const { toast } = useToast();
  const router = useRouter();

  const handleDelete = async () => {
    if (!confirm("Delete this post? This cannot be undone.")) {
      return;
    }

    const result = await deletePost(postId);

    if (result.ok) {
      toast({
        variant: "success",
        label: "Post deleted",
        title: "The article was removed.",
      });
      router.refresh();
      return;
    }

    toast({
      variant: "error",
      label: "Delete failed",
      title: result.error ?? "Could not delete the post.",
    });
  };

  return (
    <form action={handleDelete}>
      <button
        type="submit"
        className="inline-flex h-8 items-center gap-1.5 rounded border border-border px-2.5 text-sm text-ink-muted transition-colors hover:border-destructive/40 hover:text-destructive"
      >
        <Trash size={14} aria-hidden="true" />
        <span>Delete</span>
      </button>
    </form>
  );
}
