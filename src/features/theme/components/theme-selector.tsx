// /src/features/theme/components/theme-selector.tsx
"use client";

import * as React from "react";
import { Check, Palette } from "lucide-react";
import { useTheme } from "@/features/theme/hooks/use-theme";
import { cn } from "@/lib/utils";

const themes = [
  { name: "Padrão", value: "light" },
  { name: "Escuro", value: "dark" },
  { name: "Oceano", value: "theme-ocean" },
  { name: "Deserto", value: "theme-desert" },
  { name: "Floresta", value: "theme-forest" },
];

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Palette className="h-5 w-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Escolha uma aparência para o aplicativo.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {themes.map((t) => (
          <div key={t.value}>
            <button
              onClick={() => setTheme(t.value as any)}
              className={cn(
                "w-full rounded-md border-2 p-1",
                theme === t.value
                  ? "border-primary"
                  : "border-transparent"
              )}
            >
              <div
                className={cn(
                  "flex flex-col items-start gap-1 rounded-sm p-2",
                  t.value
                )}
              >
                <div className="font-semibold">{t.name}</div>
                <div className="flex w-full items-center gap-2">
                  <div className="h-4 w-4 rounded-full bg-primary" />
                  <div className="h-4 w-4 rounded-full bg-secondary" />
                  <div className="h-4 w-4 rounded-full bg-accent" />
                </div>
              </div>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
