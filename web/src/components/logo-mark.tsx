import Image from "next/image";
import logoMark from "@/brand/logo-mark.png";

/**
 * The LuxeBaddie emblem: the crowned line portrait, in rose gold on a transparent
 * background. It is drawn for dark surfaces. Size it with a height class; the width follows.
 */
export function LogoMark({ className = "" }: { className?: string }) {
  // Decorative: every place it appears also spells out the brand name.
  return <Image src={logoMark} alt="" className={`w-auto ${className}`} />;
}
