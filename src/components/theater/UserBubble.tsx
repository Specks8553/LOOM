import { useState } from "react";
import { Brain, Palette } from "lucide-react";
import { parseUserContent } from "../../lib/types";
import type { ChatMessage } from "../../lib/types";

interface UserBubbleProps {
  message: ChatMessage;
}

/**
 * User message bubble — Doc 09 §9 / Doc 02 §5.1–§5.3.
 * Right-aligned, accent-subtle background.
 * Shows plot direction always; pills for background info and modificators.
 */
export function UserBubble({ message }: UserBubbleProps) {
  const uc = parseUserContent(message.content);
  const [bgExpanded, setBgExpanded] = useState(false);
  const [modExpanded, setModExpanded] = useState(false);

  return (
    <div className="flex justify-end" style={{ padding: "4px 0" }}>
      <div
        style={{
          maxWidth: "80%",
          backgroundColor: "var(--color-accent-subtle)",
          borderRadius: "8px",
          padding: "12px 14px",
        }}
      >
        {/* Plot direction — always visible */}
        <p
          style={{
            fontSize: "14px",
            fontFamily: "var(--font-theater-body)",
            color: "var(--color-text-primary)",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            margin: 0,
          }}
        >
          {uc.plot_direction}
        </p>

        {/* Pills row */}
        {(uc.background_information.trim() || uc.modificators.length > 0) && (
          <div
            className="flex flex-wrap gap-1.5"
            style={{ marginTop: "8px" }}
          >
            {/* Background Information pill */}
            {uc.background_information.trim() && (
              <div>
                <button
                  onClick={() => setBgExpanded(!bgExpanded)}
                  className="flex items-center gap-1 transition-opacity duration-150"
                  style={{
                    background: "rgba(245,158,11,0.12)",
                    border: "1px solid rgba(245,158,11,0.25)",
                    borderRadius: "12px",
                    padding: "3px 8px",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontFamily: "var(--font-sans)",
                    fontWeight: 500,
                    color: "var(--color-warning)",
                  }}
                >
                  <Brain size={12} />
                  Background
                </button>
                {bgExpanded && (
                  <div
                    style={{
                      marginTop: "6px",
                      borderLeft: "2px solid var(--color-warning)",
                      paddingLeft: "8px",
                      fontSize: "12px",
                      fontFamily: "var(--font-sans)",
                      color: "var(--color-text-secondary)",
                      lineHeight: 1.5,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {uc.background_information}
                  </div>
                )}
              </div>
            )}

            {/* Modificators pill */}
            {uc.modificators.length > 0 && (
              <div>
                <button
                  onClick={() => setModExpanded(!modExpanded)}
                  className="flex items-center gap-1 transition-opacity duration-150"
                  style={{
                    background: "rgba(124,58,237,0.12)",
                    border: "1px solid rgba(124,58,237,0.25)",
                    borderRadius: "12px",
                    padding: "3px 8px",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontFamily: "var(--font-sans)",
                    fontWeight: 500,
                    color: "var(--color-accent-text)",
                  }}
                >
                  <Palette size={12} />
                  {truncateModificators(uc.modificators)}
                </button>
                {modExpanded && (
                  <div
                    className="flex flex-wrap gap-1"
                    style={{ marginTop: "6px" }}
                  >
                    {uc.modificators.map((mod, i) => (
                      <span
                        key={i}
                        style={{
                          background: "rgba(124,58,237,0.12)",
                          border: "1px solid rgba(124,58,237,0.25)",
                          borderRadius: "8px",
                          padding: "2px 6px",
                          fontSize: "11px",
                          fontFamily: "var(--font-sans)",
                          color: "var(--color-accent-text)",
                        }}
                      >
                        {mod}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Truncate modificators to 32 chars with ellipsis — Doc 02 §5.3. */
function truncateModificators(mods: string[]): string {
  const joined = mods.join(" · ");
  if (joined.length <= 32) return joined;
  return joined.slice(0, 29) + "...";
}
