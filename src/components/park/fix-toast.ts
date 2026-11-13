import { toastNow } from "@/components/HelloToast";
import { sfx } from "@/lib/sound";

/** A park fix was saved as a suggestion: say what happens next. */
export function sayWaiting() {
  sfx.pop();
  toastNow("Got it! It changes once another family agrees.");
}
