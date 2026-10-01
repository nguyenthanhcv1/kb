"use client";

import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { cn } from "@/components/ui/utils";

export type Feedback = { kind: "success" | "error"; message: string } | null;

/** Last result of a section's actions, announced politely (success) or assertively (error). */
export function useFeedback() {
  const [feedback, setFeedback] = useState<Feedback>(null);
  const success = useCallback((message: string) => setFeedback({ kind: "success", message }), []);
  const error = useCallback((message: string) => setFeedback({ kind: "error", message }), []);
  const clear = useCallback(() => setFeedback(null), []);
  return { feedback, success, error, clear };
}

/**
 * Live region that is always mounted (so screen readers announce changes) and only styled when
 * there is a message.
 */
export function FeedbackMessage({
  feedback,
  className,
}: {
  feedback: Feedback;
  className?: string;
}) {
  const isError = feedback?.kind === "error";
  return (
    <div role={isError ? "alert" : "status"} className={className}>
      {feedback && (
        <p
          className={cn(
            "flex items-start gap-2 rounded-md p-3 text-sm",
            isError ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground",
          )}
        >
          {isError ? (
            <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          ) : (
            <CircleCheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          )}
          <span className="min-w-0 break-words">{feedback.message}</span>
        </p>
      )}
    </div>
  );
}
