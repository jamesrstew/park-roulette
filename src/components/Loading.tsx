import { Icon } from "@/components/icons";

export function CrayonLoading({
  label = "Sharpening crayons…",
}: {
  label?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-24" role="status">
      <span className="inline-block animate-wiggle [animation-iteration-count:infinite]">
        <Icon name="crayon" size={56} />
      </span>
      <p className="font-hand text-2xl text-ink-soft">{label}</p>
    </div>
  );
}
