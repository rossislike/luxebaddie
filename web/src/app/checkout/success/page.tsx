import type { Metadata } from "next";
import { Suspense } from "react";
import { OrderConfirmation } from "@/components/order-confirmation";

export const metadata: Metadata = { title: "Order confirmed", robots: { index: false } };

export default function CheckoutSuccessPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 pt-16 lg:px-10">
      {/* The order is looked up in the browser from the session id in the URL. */}
      <Suspense fallback={<p className="text-cocoa">Confirming your order...</p>}>
        <OrderConfirmation />
      </Suspense>
    </div>
  );
}
