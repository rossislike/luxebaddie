"use client";

import { type ReactNode, useEffect, useState } from "react";

/** How long the button waits for the second click before going back to how it was. */
const CONFIRM_WITHIN_MS = 5000;

/**
 * A button for something that cannot be undone. The first click only arms it
 * and changes its label; the action runs on a second click within a few
 * seconds. A stray click therefore does nothing.
 */
export function ConfirmButton({
  children,
  confirmLabel,
  onConfirm,
  disabled = false,
  className = "btn btn-primary",
}: {
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const disarm = setTimeout(() => setArmed(false), CONFIRM_WITHIN_MS);
    return () => clearTimeout(disarm);
  }, [armed]);

  function click() {
    if (!armed) return setArmed(true);
    setArmed(false);
    onConfirm();
  }

  return (
    <button type="button" className={className} disabled={disabled} onClick={click} data-armed={armed || undefined}>
      {armed ? confirmLabel : children}
    </button>
  );
}
