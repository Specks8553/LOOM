/**
 * Three animated dots shown before the first AI token arrives.
 * Doc 09 §5.3: animate-bounce at 0ms, 150ms, 300ms delays.
 */
export function LoadingDots() {
  return (
    <div className="flex items-center gap-1" style={{ padding: "4px 0" }}>
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="inline-block rounded-full"
          style={{
            width: "6px",
            height: "6px",
            backgroundColor: "var(--color-text-muted)",
            animation: `bounce 1.4s ease-in-out ${delay}ms infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-6px); }
        }
      `}</style>
    </div>
  );
}
