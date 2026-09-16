import React, { type ReactNode } from "react";
import { MotionConfig } from "motion/react";

/** Wraps every site page in strict mode and the user's reduced-motion preference. */
export function Shell({ children }: { children: ReactNode }) {
  return <React.StrictMode><MotionConfig reducedMotion="user">{children}</MotionConfig></React.StrictMode>;
}
