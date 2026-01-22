// src/features/trading/components/deriv-trader/asset-selector-accumulators.tsx
"use client";

import React, { useEffect, useState, useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Asset } from "@/lib/types";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDerivApiAccumulators } from "../../hooks/use-deriv-api-accumulators";


interface AssetSelectorProps {
  selectedAsset: string;
  onAssetChange: (value: string) => void;
  assetGroups: { label: string, options: Asset[] }[];
  isAssetsLoading: boolean;
}

const marketFilters = [
    { label: "Todos", value: "all" },
    { label: "Sintéticos", value: "synthetic_index" },
];


export function AssetSelectorAccumulators({ selectedAsset, onAssetChange, assetGroups, isAssetsLoading }: AssetSelectorProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const [marketStatusFilter, setMarketStatusFilter] = useState('all');

  const filteredAssets = useMemo(() => {
    // Para Acumuladores, apenas Sintéticos são relevantes.
    let assets = assetGroups.find(g => g.label === 'Índices Sintéticos')?.options || [];

    if (marketStatusFilter === 'open') {
      assets = assets.filter(a => a.marketIsOpen);
    }
    
    // O filtro de mercado não é necessário pois já filtramos por sintéticos.

    return [{
        label: 'Índices Sintéticos',
        options: assets,
    }];

  }, [assetGroups, marketStatusFilter]);
  
  const selectedAssetLabel = useMemo(() => {
     const asset = assetGroups.flatMap(g => g.options).find(a => a.value === selectedAsset);
     return asset ? asset.label : "Selecione um ativo";
  }, [assetGroups, selectedAsset]);


   useEffect(() => {
    if (isAssetsLoading) return;
    const allAssets = assetGroups.flatMap(g => g.options);
    if (!selectedAsset && allAssets.length > 0) {
        onAssetChange(allAssets.find(a => a.market === 'synthetic_index')?.value || allAssets[0].value);
    }
  }, [selectedAsset, assetGroups, isAssetsLoading, onAssetChange]);


  if (isAssetsLoading) {
    return <Skeleton className="w-full sm:w-[280px] h-10" />;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full sm:w-[280px] justify-between"
        >
          <span className="truncate">{selectedAssetLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full sm:w-[380px] p-0">
        <Command>
          <CommandInput placeholder="Pesquisar ativo..." />
           <div className="p-2 border-b">
                <ToggleGroup type="single" value={marketStatusFilter} onValueChange={(v) => v && setMarketStatusFilter(v)} className="w-full">
                    <ToggleGroupItem value="all" className="w-full text-xs h-8">Todos</ToggleGroupItem>
                    <ToggleGroupItem value="open" className="w-full text-xs h-8">Abertos</ToggleGroupItem>
                </ToggleGroup>
          </div>
          <CommandList>
            <CommandEmpty>Nenhum ativo sintético encontrado.</CommandEmpty>
            {filteredAssets.map((group) => (
              <CommandGroup key={group.label} heading={group.label}>
                {group.options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.label}
                    onSelect={() => {
                      onAssetChange(option.value);
                      setOpen(false);
                    }}
                  >
                     <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-2">
                            <Check
                                className={cn(
                                "mr-2 h-4 w-4",
                                selectedAsset === option.value ? "opacity-100" : "opacity-0"
                                )}
                            />
                            <span>{option.label}</span>
                        </div>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger>
                                     <div className={cn("h-2 w-2 rounded-full", option.marketIsOpen ? "bg-green-500" : "bg-muted-foreground")}/>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>Mercado {option.marketIsOpen ? "Aberto" : "Fechado"}</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}