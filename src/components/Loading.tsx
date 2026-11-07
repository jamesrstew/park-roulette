export function CrayonLoading({
  label = "Sharpening crayons…",
}: {
  label?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-24" role="status">
      <span className="inline-block animate-wiggle text-5xl [animation-iteration-count:infinite]">
        🖍️
      </span>
      <p className="font-hand text-2xl text-ink-soft">{label}</p>
    </div>
  );
}
