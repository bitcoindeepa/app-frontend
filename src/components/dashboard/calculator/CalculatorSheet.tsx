"use client";

import { Sheet } from "@/components/ui/sheet";
import { Calculator } from "./Calculator";

/** LKR / USD / BTC / sats calculator, opened from the Total value card. */
export default function CalculatorSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Calculator">
      <div className="px-4 pb-2">
        <Calculator />
      </div>
    </Sheet>
  );
}
