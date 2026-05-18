"use client";

interface PromptButtonProps {
  prompt: string;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}

// Dispatches an `acropolisos:prompt` CustomEvent with the prompt text.
// The chat-panel listens and populates its textarea + focuses, so the
// user can review/edit before sending (Voice 1 staging).
export function PromptButton({
  prompt,
  children,
  className,
  testId,
}: PromptButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() => {
        if (typeof window === "undefined") return;
        window.dispatchEvent(
          new CustomEvent("acropolisos:prompt", { detail: { prompt } }),
        );
      }}
      className={className}
    >
      {children}
    </button>
  );
}
