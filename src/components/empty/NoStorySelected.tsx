import { useVaultStore } from "../../stores/vaultStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { formatRelativeTime } from "../../lib/timeUtils";

export function NoStorySelected() {
  const items = useVaultStore((s) => s.items);
  const setActiveStoryId = useWorkspaceStore((s) => s.setActiveStoryId);
  const setShowingTrash = useVaultStore((s) => s.setShowingTrash);

  // Get up to 5 most recently modified stories
  const recentStories = items
    .filter((i) => i.item_type === "Story")
    .sort((a, b) => new Date(b.modified_at).getTime() - new Date(a.modified_at).getTime())
    .slice(0, 5);

  const handleStoryClick = (storyId: string) => {
    setShowingTrash(false);
    setActiveStoryId(storyId);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full">
      {recentStories.length > 0 ? (
        <div style={{ width: "280px" }}>
          <h3
            style={{
              fontSize: "11px",
              fontWeight: 500,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--color-text-muted)",
              marginBottom: "12px",
            }}
          >
            Recent Stories
          </h3>

          <div className="flex flex-col gap-1">
            {recentStories.map((story) => (
              <button
                key={story.id}
                onClick={() => handleStoryClick(story.id)}
                className="flex flex-col gap-0.5 text-left transition-colors duration-150"
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: "8px 10px",
                  borderRadius: "6px",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <span
                  style={{
                    fontSize: "14px",
                    color: "var(--color-text-primary)",
                    fontWeight: 500,
                  }}
                >
                  {story.name}
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    color: "var(--color-text-muted)",
                  }}
                >
                  {formatRelativeTime(story.modified_at)}
                </span>
              </button>
            ))}
          </div>

          <p
            style={{
              fontSize: "13px",
              color: "var(--color-text-muted)",
              marginTop: "16px",
              textAlign: "center",
            }}
          >
            or select a story from the Navigator
          </p>
        </div>
      ) : (
        <p
          style={{
            fontSize: "13px",
            color: "var(--color-text-muted)",
            textAlign: "center",
          }}
        >
          Select a story from the Navigator, or create one to begin.
        </p>
      )}
    </div>
  );
}
