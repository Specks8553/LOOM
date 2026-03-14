import { Search } from "lucide-react";

export function NoSearchResults({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-8">
      <Search size={20} style={{ color: "var(--color-text-muted)" }} />
      <p
        style={{
          fontSize: "12px",
          color: "var(--color-text-muted)",
          textAlign: "center",
        }}
      >
        No results for &ldquo;{query}&rdquo;
      </p>
    </div>
  );
}
