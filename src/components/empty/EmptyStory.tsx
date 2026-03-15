export function EmptyStory() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2">
      <p
        style={{
          fontSize: "17px",
          fontFamily: "var(--font-theater-body)",
          fontStyle: "italic",
          color: "var(--color-text-muted)",
        }}
      >
        Your story begins here.
      </p>
      <p
        style={{
          fontSize: "13px",
          fontFamily: "var(--font-sans)",
          color: "var(--color-text-muted)",
        }}
      >
        Write a plot direction and press Send to start.
      </p>
    </div>
  );
}
