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
import { useDerivApiDigits } from "../../hooks/use-deriv-api-digits";


interface AssetSelectorProps {
  selectedAsset: string;
  onAssetChange: (value: string) => void;
  assetGroups: { label: string, options: Asset[] }[];
  isAssetsLoading: boolean;
}

export function AssetSelectorDigits({ selectedAsset, onAssetChange, assetGroups, isAssetsLoading }: AssetSelectorProps) {
  const [open, setOpen] = useState(false);
  const [marketStatusFilter, setMarketStatusFilter] = useState('all');

  const filteredAssets = useMemo(() => {
    // The assetGroups are already pre-filtered for Digits compatibility in the API hook.
    // We just need to apply the UI filters like market status.
    const newGroups = assetGroups.map(group => ({
      label: group.label,
      options: group.options.filter(asset => {
        if (marketStatusFilter === 'open' && !asset.marketIsOpen) {
          return false;
        }
        return true;
      }),
    }));

    return newGroups.filter(group => group.options.length > 0);
  }, [assetGroups, marketStatusFilter]);
  
  const selectedAssetLabel = useMemo(() => {
     for (const group of assetGroups) {
      const asset = group.options.find(a => a.value === selectedAsset);
      if (asset) return asset.label;
    }
    return "Selecione um ativo";
  }, [assetGroups, selectedAsset]);


   useEffect(() => {
    if (isAssetsLoading) return;
    const allAssets = assetGroups.flatMap(g => g.options);
    const defaultAsset = allAssets.find(a => a.value === '1HZ10V');
    
    // If no asset is selected OR the selected asset isn't in the list anymore
    if (!selectedAsset || !allAssets.some(a => a.value === selectedAsset)) {
      if (defaultAsset) {
        onAssetChange('1HZ10V');
      } else if (allAssets.length > 0) {
        onAssetChange(allAssets[0].value);
      }
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
            <CommandEmpty>Nenhum ativo encontrado para este filtro.</CommandEmpty>
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
