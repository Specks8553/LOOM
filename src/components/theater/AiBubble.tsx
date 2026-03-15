import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { marked } from "marked";
import { formatShortTime } from "../../lib/timeUtils";
import { LoadingDots } from "./LoadingDots";
import type { ChatMessage } from "../../lib/types";

interface AiBubbleProps {
  message: ChatMessage;
  isStreaming: boolean;
}

// Configure marked for safe rendering
marked.setOptions({
  breaks: true,
  gfm: true,
});

/**
 * AI message bubble — Doc 09 §10 / Doc 02 §5.1.
 * Left-aligned, dark background. Renders Markdown content.
 * Shows safety filter warning per Doc 09 §11.
 */
export function AiBubble({ message, isStreaming }: AiBubbleProps) {
  const isSafety = message.finish_reason === "SAFETY";
  const isError = message.finish_reason === "ERROR";
  const showLoading = isStreaming && !message.content;

  const renderedHtml = useMemo(() => {
    if (!message.content) return "";
    return marked.parse(message.content) as string;
  }, [message.content]);

  // Safety filter bubble — Doc 09 §11
  if (isSafety) {
    return (
      <div className="flex justify-start" style={{ padding: "4px 0" }}>
        <div
          style={{
            maxWidth: "80%",
            background: "rgba(244,63,94,0.08)",
            border: "1px solid rgba(244,63,94,0.25)",
            borderRadius: "8px",
            padding: "12px 14px",
          }}
        >
          <div
            className="flex items-center gap-2"
            style={{
              fontSize: "11px",
              fontFamily: "var(--font-sans)",
              color: "var(--color-text-muted)",
              marginBottom: "8px",
            }}
          >
            <span>AI</span>
            <span>·</span>
            <span>{formatShortTime(message.created_at)}</span>
            <span
              className="flex items-center gap-1"
              style={{ color: "var(--color-error)", marginLeft: "auto" }}
            >
              <AlertTriangle size={12} />
              Safety
            </span>
          </div>
          <p
            style={{
              fontSize: "14px",
              fontFamily: "var(--font-theater-body)",
              color: "var(--color-text-secondary)",
              margin: 0,
              lineHeight: 1.6,
            }}
          >
            Response blocked by Gemini safety filters.
            <br />
            Try rephrasing your plot direction.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start" style={{ padding: "4px 0" }}>
      <div
        style={{
          maxWidth: "80%",
          backgroundColor: "var(--color-bg-elevated)",
          borderRadius: "8px",
          padding: "12px 14px",
        }}
      >
        {/* Header: AI · time · tokens · model */}
        <div
          className="flex items-center gap-1.5 flex-wrap"
          style={{
            fontSize: "11px",
            fontFamily: "var(--font-sans)",
            color: "var(--color-text-muted)",
            marginBottom: "8px",
          }}
        >
          <span style={{ fontWeight: 600 }}>AI</span>
          <span>·</span>
          <span>{formatShortTime(message.created_at)}</span>
          {message.token_count != null && (
            <>
              <span>·</span>
              <span>{message.token_count} tok</span>
            </>
          )}
          {message.model_name && (
            <>
              <span>·</span>
              <span>{message.model_name}</span>
            </>
          )}
          {isError && (
            <span
              className="flex items-center gap-1"
              style={{ color: "var(--color-warning)", marginLeft: "auto" }}
              title="Generation was stopped — response may be incomplete."
            >
              <AlertTriangle size={12} />
            </span>
          )}
        </div>

        {/* Content */}
        {showLoading ? (
          <LoadingDots />
        ) : (
          <div
            className="ai-message-content"
            style={{
              fontSize: "15px",
              fontFamily: "var(--font-theater-body)",
              color: "var(--color-text-primary)",
              lineHeight: 1.7,
            }}
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        )}
      </div>
    </div>
  );
}
