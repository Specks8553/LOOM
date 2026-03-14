import { BookOpen } from "lucide-react";

export function EmptyVault({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-8">
      <BookOpen size={28} style={{ color: "var(--color-text-muted)" }} />
      <p
        style={{
          fontSize: "12px",
          color: "var(--color-text-muted)",
          textAlign: "center",
          lineHeight: 1.6,
        }}
      >
        No items yet.
        <br />
        <button
          onClick={onCreateClick}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--color-accent-text)",
            fontSize: "12px",
            padding: 0,
            textDecoration: "underline",
            textUnderlineOffset: "2px",
          }}
        >
          Create your first story or document
        </button>
      </p>
    </div>
  );
}
