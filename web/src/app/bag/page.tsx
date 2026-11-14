import type { Metadata } from "next";
import { Bag } from "@/components/bag";

export const metadata: Metadata = { title: "Your bag" };

export default function BagPage() {
  return (
    <div className="mx-auto max-w-5xl px-5 pt-14 lg:px-10">
      <h1 className="font-display text-5xl sm:text-6xl">Your bag</h1>
      <Bag />
    </div>
  );
}
