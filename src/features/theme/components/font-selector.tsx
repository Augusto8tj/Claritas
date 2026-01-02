// /src/features/theme/components/font-selector.tsx
"use client";

import { Check, CaseSensitive } from "lucide-react";
import { useTheme } from "@/features/theme/hooks/use-theme";
import { cn } from "@/lib/utils";

const fonts = [
  { name: "Inter", value: "font-body" },
  { name: "Roboto", value: "font-roboto" },
  { name: "Lato", value: "font-lato" },
  { name: "Courier", value: "font-courier" },
  { name: "Script", value: "font-script" },
];

export function FontSelector() {
  const { font, setFont } = useTheme();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <CaseSensitive className="h-5 w-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Escolha uma fonte para a interface.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {fonts.map((f) => (
          <button
            key={f.value}
            onClick={() => setFont(f.value as any)}
            className={cn(
              "w-full rounded-md border-2 p-1",
              font === f.value ? "border-primary" : "border-transparent"
            )}
          >
            <div className="flex items-center justify-center rounded-sm bg-muted p-4">
              <span className={cn("text-lg", f.value)}>{f.name}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
