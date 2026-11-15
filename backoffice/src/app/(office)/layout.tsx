import { SignedInOnly } from "@/auth/signed-in-only";
import { OfficeHeader } from "@/components/office-header";

/** Every screen of the back office. Nothing inside is shown, or loaded, until the owner is signed in. */
export default function OfficeLayout({ children }: LayoutProps<"/">) {
  return (
    <SignedInOnly>
      <OfficeHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-10">{children}</main>
    </SignedInOnly>
  );
}
