"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { name: "Articles", href: "/admin" },
  { name: "New post", href: "/admin/new" },
  { name: "AI settings", href: "/admin/settings" },
  { name: "Prompts", href: "/admin/prompts" },
  { name: "Search Console", href: "/admin/search-console" },
  { name: "Keywords", href: "/admin/keywords" },
];

export default function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-5" aria-label="Admin">
      {items.map((item) => {
        const isActive =
          item.href === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.name}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "text-sm text-ink-muted transition-colors hover:text-foreground",
              isActive && "text-foreground underline decoration-1 underline-offset-4",
            )}
          >
            {item.name}
          </Link>
        );
      })}
    </nav>
  );
}
