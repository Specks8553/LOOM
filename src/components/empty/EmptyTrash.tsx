import { Trash2 } from "lucide-react";

export function EmptyTrash() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-16">
      <Trash2 size={28} style={{ color: "var(--color-text-muted)" }} />
      <p
        style={{
          fontSize: "12px",
          color: "var(--color-text-muted)",
          textAlign: "center",
        }}
      >
        Trash is empty.
      </p>
    </div>
  );
}
