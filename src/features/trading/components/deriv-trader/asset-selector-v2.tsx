// src/features/trading/components/deriv-trader/asset-selector-v2.tsx
"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import React, { useEffect, useState, useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useDerivApiV2 } from "@/features/trading/hooks/use-deriv-api-v2";
import type { Asset } from "@/lib/types";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";


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

export function AssetSelectorV2({ selectedAsset, onAssetChange, assetGroups, isAssetsLoading }: AssetSelectorProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const [marketStatusFilter, setMarketStatusFilter] = useState('all');
  const [durationFilter, setDurationFilter] = useState('all');

  const filteredAssets = useMemo(() => {
    let assets = assetGroups.flatMap(g => g.options);

    // 1. Filter by Market Status
    if (marketStatusFilter === 'open') {
      assets = assets.filter(a => a.marketIsOpen);
    } else if (marketStatusFilter === 'closed') {
      assets = assets.filter(a => !a.marketIsOpen);
    }

    // 2. Filter by Duration Type
    if (durationFilter === 'tick') {
        assets = assets.filter(a => a.minDuration && a.minDuration.endsWith('t'));
    } else if (durationFilter === 'time') {
        assets = assets.filter(a => a.minDuration && !a.minDuration.endsWith('t'));
    }

    // 3. Filter by Market Type
    if (filter !== 'all') {
      assets = assets.filter(a => a.market === filter);
    }

    // Regroup assets after filtering
    const regrouped: { [key: string]: Asset[] } = {};
    assets.forEach(asset => {
        const groupLabel = assetGroups.find(g => g.options.some(o => o.value === asset.value))?.label || 'Outros';
        if (!regrouped[groupLabel]) {
            regrouped[groupLabel] = [];
        }
        regrouped[groupLabel].push(asset);
    });

    return Object.keys(regrouped).map(label => ({
        label,
        options: regrouped[label],
    })).filter(group => group.options.length > 0);

  }, [assetGroups, filter, marketStatusFilter, durationFilter]);
  
  const selectedAssetLabel = useMemo(() => {
     for (const group of assetGroups) {
      const asset = group.options.find(a => a.value === selectedAsset);
      if (asset) return asset.label;
    }
    return "Selecione um ativo";
  }, [assetGroups, selectedAsset]);

  // Conta quantos ativos cada filtro tem
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

  // Find the currently selected asset's market to set the initial filter
   useEffect(() => {
    if (isAssetsLoading) return;
    
    const asset = assetGroups.flatMap(g => g.options).find(a => a.value === selectedAsset);
    if (asset && asset.market) {
        const filterExists = marketFilters.some(f => f.value === asset.market);
        if (filterExists) {
            setFilter(asset.market);
        } else {
            console.warn('⚠️ Market do ativo não encontrado nos filtros:', asset.market);
            setFilter('all');
        }
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
                <p className="text-xs text-muted-foreground px-1 pb-1">Mercado:</p>
                <div className="flex flex-wrap gap-1">
                  {marketFilters.map(f => (
                      <Button 
                          key={f.value}
                          variant={filter === f.value ? "default" : "outline"}
                          size="sm"
                          className="h-7 text-xs rounded-full"
                          onClick={() => setFilter(f.value)}
                          disabled={filterCounts[f.value] === 0}
                      >
                          {f.label} {filterCounts[f.value] !== undefined && `(${filterCounts[f.value]})`}
                      </Button>
                  ))}
                </div>
              </div>
               <div className="grid grid-cols-2 gap-2">
                    <div>
                        <p className="text-xs text-muted-foreground px-1 pb-1">Status:</p>
                        <ToggleGroup type="single" value={marketStatusFilter} onValueChange={(v) => v && setMarketStatusFilter(v)} className="w-full">
                            <ToggleGroupItem value="all" className="w-full text-xs h-8">Todos</ToggleGroupItem>
                            <ToggleGroupItem value="open" className="w-full text-xs h-8">Abertos</ToggleGroupItem>
                        </ToggleGroup>
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground px-1 pb-1">Duração:</p>
                        <ToggleGroup type="single" value={durationFilter} onValueChange={(v) => v && setDurationFilter(v)} className="w-full">
                            <ToggleGroupItem value="all" className="w-1/3 text-xs h-8">Todas</ToggleGroupItem>
                            <ToggleGroupItem value="tick" className="w-1/3 text-xs h-8">Ticks</ToggleGroupItem>
                            <ToggleGroupItem value="time" className="w-1/3 text-xs h-8">Tempo</ToggleGroupItem>
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
                        <div className="flex items-center">
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
