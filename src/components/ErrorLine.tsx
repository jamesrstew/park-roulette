import { Icon } from "@/components/icons";

/** Error words: ink on paper (crayon red alone is too faint to read). */
export function ErrorLine({ id, children }: { id?: string; children: string }) {
  return (
    <p
      id={id}
      role="alert"
      className="flex items-start gap-1.5 font-hand text-xl leading-tight text-ink"
    >
      <Icon name="warning" size={22} className="mt-0.5 shrink-0" />
      <span className="underline decoration-crayon-red decoration-wavy decoration-2 underline-offset-4">
        {children}
      </span>
    </p>
  );
}
