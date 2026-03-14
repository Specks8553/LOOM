import { useState, useRef, useEffect, useCallback } from "react";
import { Search, X } from "lucide-react";
import { useVaultStore } from "../../stores/vaultStore";

export function FilterInput() {
  const filterQuery = useVaultStore((s) => s.filterQuery);
  const setFilterQuery = useVaultStore((s) => s.setFilterQuery);
  const [localValue, setLocalValue] = useState(filterQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local value when store is cleared externally
  useEffect(() => {
    if (filterQuery === "" && localValue !== "") {
      setLocalValue("");
    }
  }, [filterQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = useCallback(
    (value: string) => {
      setLocalValue(value);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setFilterQuery(value);
      }, 150);
    },
    [setFilterQuery],
  );

  const handleClear = useCallback(() => {
    setLocalValue("");
    setFilterQuery("");
    inputRef.current?.focus();
  }, [setFilterQuery]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleClear();
      }
    },
    [handleClear],
  );

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div
      className="flex items-center gap-1.5 px-2"
      style={{
        height: "32px",
        backgroundColor: "var(--color-bg-hover)",
        borderBottom: "1px solid var(--color-border-subtle)",
        margin: "0 8px 4px 8px",
        borderRadius: "4px",
      }}
    >
      <Search size={14} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
      <input
        ref={inputRef}
        type="text"
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Filter..."
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          outline: "none",
          fontSize: "13px",
          color: "var(--color-text-primary)",
          fontFamily: "var(--font-sans)",
          minWidth: 0,
        }}
      />
      {localValue && (
        <button
          onClick={handleClear}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "2px",
            display: "flex",
            alignItems: "center",
            color: "var(--color-text-muted)",
            flexShrink: 0,
          }}
          title="Clear filter"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
