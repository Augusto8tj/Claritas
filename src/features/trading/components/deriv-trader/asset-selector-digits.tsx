// src/features/trading/components/deriv-trader/asset-selector-digits.tsx
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
import { Badge } from "@/components/ui/badge";

interface AssetSelectorProps {
  selectedAsset: string;
  onAssetChange: (value: string) => void;
  assetGroups: { label: string, options: Asset[] }[];
  isAssetsLoading: boolean;
}

const marketFilters = [
    { label: "Todos", value: "all" },
    { label: "Sintéticos", value: "synthetic_index" },
    { label: "Forex", value: "forex" },
    { label: "Matérias-Primas", value: "commodities" },
    { label: "Cestas", value: "basket_index" },
    { label: "Índices", value: "stock_index" },
    { label: "Cripto", value: "cryptocurrency" },
];

export function AssetSelectorDigits({ selectedAsset, onAssetChange, assetGroups, isAssetsLoading }: AssetSelectorProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const [marketStatusFilter, setMarketStatusFilter] = useState('all');

  const filteredAssets = useMemo(() => {
    let assets = assetGroups.flatMap(g => g.options);

    if (marketStatusFilter === 'open') {
      assets = assets.filter(a => a.marketIsOpen);
    }

    if (filter !== 'all') {
      assets = assets.filter(a => a.market === filter);
    }

    const regrouped: { [key: string]: Asset[] } = {};
    assets.forEach(asset => {
        const groupLabel = assetGroups.find(g => g.options.some(o => o.value === asset.value))?.label || 'Outros';
        if (!regrouped[groupLabel]) regrouped[groupLabel] = [];
        regrouped[groupLabel].push(asset);
    });

    return Object.keys(regrouped).map(label => ({
        label,
        options: regrouped[label],
    })).filter(group => group.options.length > 0);

  }, [assetGroups, filter, marketStatusFilter]);
  
  const selectedAssetLabel = useMemo(() => {
     for (const group of assetGroups) {
      const asset = group.options.find(a => a.value === selectedAsset);
      if (asset) return asset.label;
    }
    return "Selecione um ativo";
  }, [assetGroups, selectedAsset]);

  const filterCounts = useMemo(() => {
    const allAssets = assetGroups.flatMap(g => g.options);
    const counts: Record<string, number> = { all: allAssets.length };
    
    marketFilters.forEach(f => {
      if (f.value !== 'all') {
        counts[f.value] = allAssets.filter(a => a.market === f.value).length;
      }
    });
    
    return counts;
  }, [assetGroups]);

   useEffect(() => {
    if (isAssetsLoading) return;
    const asset = assetGroups.flatMap(g => g.options).find(a => a.value === selectedAsset);
    if (asset && asset.market) {
        setFilter(asset.market);
    }
  }, [selectedAsset, assetGroups, isAssetsLoading]);


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
           <div className="p-2 border-b space-y-2">
              <div>
                <p className="text-xs text-muted-foreground px-1 pb-1 font-bold">Mercado:</p>
                <div className="flex flex-wrap gap-1">
                  {marketFilters.map(f => (
                      <Button 
                          key={f.value}
                          variant={filter === f.value ? "default" : "outline"}
                          size="sm"
                          className="h-7 text-[11px] px-2 rounded-full"
                          onClick={() => setFilter(f.value)}
                          disabled={filterCounts[f.value] === 0 && f.value !== 'all'}
                      >
                          {f.label} ({filterCounts[f.value] || 0})
                      </Button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                    <div>
                        <p className="text-xs text-muted-foreground px-1 pb-1 font-bold">Status:</p>
                        <ToggleGroup type="single" value={marketStatusFilter} onValueChange={(v) => v && setMarketStatusFilter(v)} className="w-full">
                            <ToggleGroupItem value="all" className="w-full text-xs h-8">Todos</ToggleGroupItem>
                            <ToggleGroupItem value="open" className="w-full text-xs h-8">Abertos</ToggleGroupItem>
                        </ToggleGroup>
                    </div>
               </div>
          </div>
          <CommandList>
            <CommandEmpty>Nenhum ativo encontrado para estes filtros.</CommandEmpty>
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
