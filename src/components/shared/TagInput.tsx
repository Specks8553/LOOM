import { useState, useRef, useCallback } from "react";
import { X } from "lucide-react";

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  style?: React.CSSProperties;
  /** Font size for tags and input — defaults to 13 */
  fontSize?: number;
}

/**
 * Tag input field for modificators.
 * - Type comma to create a tag from current input
 * - Backspace on empty input deletes the last tag
 * - Click X on a tag to remove it
 */
export function TagInput({
  tags,
  onChange,
  placeholder,
  onKeyDown,
  inputRef: externalRef,
  style,
  fontSize = 13,
}: TagInputProps) {
  const [inputValue, setInputValue] = useState("");
  const internalRef = useRef<HTMLInputElement>(null);
  const ref = externalRef ?? internalRef;

  // Sync: if tags change externally, don't clear current input
  const commitTag = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed && !tags.includes(trimmed)) {
        onChange([...tags, trimmed]);
      }
    },
    [tags, onChange],
  );

  const removeTag = useCallback(
    (index: number) => {
      onChange(tags.filter((_, i) => i !== index));
    },
    [tags, onChange],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      // If comma is typed, commit the tag
      if (val.endsWith(",")) {
        commitTag(val.slice(0, -1));
        setInputValue("");
      } else {
        setInputValue(val);
      }
    },
    [commitTag],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Backspace" && inputValue === "" && tags.length > 0) {
        e.preventDefault();
        removeTag(tags.length - 1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (inputValue.trim()) {
          commitTag(inputValue);
          setInputValue("");
        }
      }
      // Forward other key events (e.g. Ctrl+Enter to send)
      onKeyDown?.(e);
    },
    [inputValue, tags, commitTag, removeTag, onKeyDown],
  );

  // Focus the input when clicking the container
  const handleContainerClick = useCallback(() => {
    ref.current?.focus();
  }, [ref]);

  return (
    <div
      onClick={handleContainerClick}
      className="flex flex-wrap items-center gap-1"
      style={{
        width: "100%",
        background: "var(--color-bg-pane)",
        border: "1px solid rgba(124,58,237,0.3)",
        borderRadius: "6px",
        padding: "4px 8px",
        minHeight: "34px",
        cursor: "text",
        ...style,
      }}
    >
      {tags.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
          className="flex items-center gap-1 shrink-0"
          style={{
            background: "rgba(124,58,237,0.15)",
            border: "1px solid rgba(124,58,237,0.3)",
            borderRadius: "4px",
            padding: "1px 6px",
            fontSize: `${fontSize - 1}px`,
            fontFamily: "var(--font-sans)",
            color: "var(--color-accent-text)",
            lineHeight: 1.4,
          }}
        >
          {tag}
          <button
            onClick={(e) => {
              e.stopPropagation();
              removeTag(i);
            }}
            className="flex items-center justify-center"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              color: "var(--color-accent-text)",
              opacity: 0.6,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = "1";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = "0.6";
            }}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        ref={ref}
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        placeholder={tags.length === 0 ? (placeholder ?? "Type and press comma...") : ""}
        style={{
          flex: 1,
          minWidth: "80px",
          background: "transparent",
          border: "none",
          outline: "none",
          fontSize: `${fontSize}px`,
          fontFamily: "var(--font-sans)",
          color: "var(--color-text-primary)",
          padding: "2px 0",
        }}
      />
    </div>
  );
}
