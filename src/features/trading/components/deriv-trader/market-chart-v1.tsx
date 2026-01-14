// src/features/trading/components/deriv-trader/market-chart-v1.tsx
'use client'

// ESTE ARQUIVO É UMA CÓPIA DEDICADA PARA O SISTEMA V1

import React, { useCallback } from 'react'
import {
  Settings,
  Loader2,
  AreaChart,
  CandlestickChart,
  Clock,
} from 'lucide-react'
import { useTheme as useAppTheme } from '@/features/theme/hooks/use-theme'
import type {
  ChartData,
  CandleData,
  TimePeriod,
  ChartType,
  TradeAnnotation,
} from '@/lib/types'
import { THEMES } from './chart-parts/themes'
import type { Operation } from '@/lib/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { TradeLegend } from './trade-legend'
import type { Indicators } from '@/services/indicator-service-v1';
import { useDerivApiV1 } from '../../hooks/use-deriv-api-v1';


interface MarketChartProps {
  activeSymbol: string
  chartData: ChartData[]
  isChartLoading: boolean
  chartError: string | null
  chartType: ChartType
  setChartType: (type: ChartType) => void
  timePeriod: TimePeriod
  setTimePeriod: (period: TimePeriod) => void
  operations: Operation[]
  indicators: Indicators | null,
  tradeAnnotations: TradeAnnotation[];
}

const Y_AXIS_WIDTH = 80
const PADDING = { top: 20, right: Y_AXIS_WIDTH, bottom: 40, left: 10 }
const BRUSH_HEIGHT = 60
const MIN_CANDLE_WIDTH = 1
const MAX_CANDLE_WIDTH = 20

const isCandle = (d: ChartData): d is CandleData =>
    'open' in d && d.open !== undefined;

const getDisplayPrice = (d: ChartData) =>
  isCandle(d) ? d.close : d.price;


export function MarketChartV1({
  activeSymbol,
  chartData: rawData,
  isChartLoading,
  chartError,
  chartType,
  setChartType,
  timePeriod,
  setTimePeriod,
  operations,
  indicators,
  tradeAnnotations,
}: MarketChartProps) {
  const { theme: appTheme } = useAppTheme()
  const mainCanvasRef = React.useRef<HTMLCanvasElement>(null)
  const brushCanvasRef = React.useRef<HTMLCanvasElement>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const rafIdRef = React.useRef<number | null>(null);

  const colors = THEMES[appTheme.includes('dark') ? 'dark' : 'light'];

  const [visibleIndicators, setVisibleIndicators] = React.useState({
    sma: false,
    ema: false,
    vwap: false,
    bb: false,
  })

  const [brushWindow, setBrushWindow] = React.useState({
    min: 0,
    max: 1,
  })
  
  const [mousePosition, setMousePosition] = React.useState<{x: number, y: number} | null>(null);


  const brushRef = React.useRef({
    isBrushing: false,
    isDragging: false,
    startX: 0,
    target: '' as 'min' | 'max' | 'body' | '',
  })

  const timePeriods: TimePeriod[] = [
    '1m',
    '2m',
    '3m',
    '5m',
    '10m',
    '15m',
    '30m',
    '1h',
    '8h',
    '1d',
  ]
  
  const dataWindow = React.useMemo(() => {
    const start = Math.floor(rawData.length * brushWindow.min)
    const end = Math.ceil(rawData.length * brushWindow.max)
    return { start, end }
  }, [rawData.length, brushWindow.min, brushWindow.max])

  const visibleData = React.useMemo(
    () => rawData.slice(dataWindow.start, dataWindow.end),
    [rawData, dataWindow]
  )

  const hasActiveTrades = React.useMemo(() => 
    tradeAnnotations.some(ann => ann.symbol === activeSymbol && !ann.exitTime),
    [tradeAnnotations, activeSymbol]
  );

  const slicedIndicators = React.useMemo(() => {
    if (!indicators) {
      return { sma: [], ema: [], vwap: [], bollingerBands: [] };
    }
    
    const vwapArray = Array.isArray(indicators.vwap) ? indicators.vwap : [];
    const bollingerBandsArray = Array.isArray(indicators.bollingerBands) ? indicators.bollingerBands : [];


    return {
      sma: indicators.sma.slice(dataWindow.start, dataWindow.end),
      ema: indicators.ema.slice(dataWindow.start, dataWindow.end),
      vwap: vwapArray.slice(dataWindow.start, dataWindow.end),
      bollingerBands: bollingerBandsArray.slice(
        dataWindow.start,
        dataWindow.end
      ),
    }
  }, [indicators, dataWindow])

  const drawLineIndicator = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      indicatorData: (number | null)[],
      color: string,
      getY: (price: number) => number,
      getX: (index: number) => number
    ) => {
      ctx.beginPath()
      let firstPoint = true
      indicatorData.forEach((val, i) => {
        if (val === null) return
        const x = getX(i)
        const y = getY(val)
        if (firstPoint) {
          ctx.moveTo(x, y)
          firstPoint = false
        } else {
          ctx.lineTo(x, y)
        }
      })
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.stroke()
    },
    []
  )

  const drawBollingerBands = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      bbData: ({ upper: number; middle: number; lower: number } | null)[],
      color: string,
      getY: (price: number) => number,
      getX: (index: number) => number
    ) => {
      ctx.beginPath()
      let firstMiddle = true
      bbData.forEach((d, i) => {
        if (!d) return
        const x = getX(i)
        const y = getY(d.middle)
        if (firstMiddle) {
          ctx.moveTo(x, y)
          firstMiddle = false
        } else {
          ctx.lineTo(x, y)
        }
      })
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.setLineDash([4, 2])
      ctx.stroke()
      ctx.setLineDash([])

      const upperPath = new Path2D()
      const lowerPath = new Path2D()
      let firstUpper = true
      let firstLower = true

      bbData.forEach((d, i) => {
        if (!d) return
        const x = getX(i)
        if (firstUpper) {
          upperPath.moveTo(x, getY(d.upper))
          firstUpper = false
        } else {
          upperPath.lineTo(x, getY(d.upper))
        }

        if (firstLower) {
          lowerPath.moveTo(x, getY(d.lower))
          firstLower = false
        } else {
          lowerPath.lineTo(x, getY(d.lower))
        }
      })

      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.stroke(upperPath)
      ctx.stroke(lowerPath)

      const fillPath = new Path2D()
      let firstFill = true

      bbData.forEach((d, i) => {
        if (!d) return
        const x = getX(i)
        const y = getY(d.upper)
        if (firstFill) {
          fillPath.moveTo(x, y)
          firstFill = false
        } else {
          fillPath.lineTo(x, y)
        }
      })

      for (let i = bbData.length - 1; i >= 0; i--) {
        const d = bbData[i]
        if (!d) continue
        const x = getX(i)
        const y = getY(d.lower)
        fillPath.lineTo(x, y)
      }

      fillPath.closePath()
      ctx.fillStyle = colors.bbFill
      ctx.fill(fillPath)
    },
    [colors.bbFill]
  )

  const drawMainChart = useCallback(() => {
    const canvas = mainCanvasRef.current
    const container = containerRef.current
    if (!canvas || !container || visibleData.length === 0) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.scale(dpr, dpr)
    const width = rect.width
    const height = rect.height
    const chartHeight = height - PADDING.top - PADDING.bottom

    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = colors.bg
    ctx.fillRect(0, 0, width, height)

    let minPrice = Infinity
    let maxPrice = -Infinity
    
    visibleData.forEach((d, i) => {
      const pricePoints: (number | null)[] = []
      if (isCandle(d)) {
        pricePoints.push(d.low, d.high)
      } else {
        pricePoints.push(d.price)
      }

      if (visibleIndicators.sma && slicedIndicators.sma[i]) pricePoints.push(slicedIndicators.sma[i])
      if (visibleIndicators.ema && slicedIndicators.ema[i]) pricePoints.push(slicedIndicators.ema[i])
      if (visibleIndicators.vwap && slicedIndicators.vwap[i]) pricePoints.push(slicedIndicators.vwap[i])
      if (visibleIndicators.bb && slicedIndicators.bollingerBands[i]) {
        pricePoints.push(slicedIndicators.bollingerBands[i]!.upper, slicedIndicators.bollingerBands[i]!.lower)
      }
    
      const validPrices = pricePoints.filter(p => p !== null) as number[]
      minPrice = Math.min(minPrice, ...validPrices)
      maxPrice = Math.max(maxPrice, ...validPrices)
    });

    const priceRange = maxPrice - minPrice || 1
    const pricePadding = priceRange * 0.1
    minPrice -= pricePadding
    maxPrice += pricePadding

    const getY = (price: number) =>
      PADDING.top +
      chartHeight -
      ((price - minPrice) / (maxPrice - minPrice)) * chartHeight
      
    const getPrice = (y: number) =>
      maxPrice - ((y - PADDING.top) / chartHeight) * (maxPrice - minPrice);

    const getX = (index: number) => {
      if (visibleData.length <= 1) return PADDING.left
      return (
        PADDING.left +
        (index / (visibleData.length - 1)) *
          (width - PADDING.left - PADDING.right)
      )
    }

    ctx.strokeStyle = colors.grid
    ctx.lineWidth = 0.5
    ctx.font = '10px sans-serif'
    ctx.fillStyle = colors.text
    const gridLines = 5
    for (let i = 0; i <= gridLines; i++) {
      const y = PADDING.top + (chartHeight / gridLines) * i
      ctx.beginPath()
      ctx.moveTo(PADDING.left, y)
      ctx.lineTo(width - PADDING.right, y)
      ctx.stroke()
      const price = maxPrice - (i / gridLines) * (maxPrice - minPrice)
      ctx.fillText(price.toFixed(4), width - PADDING.right + 5, y + 3)
    }

    const labelCount = Math.floor((width - PADDING.left - PADDING.right) / 100)
    const labelInterval = Math.max(
      1,
      Math.floor(visibleData.length / labelCount)
    )
    for (let i = 0; i < visibleData.length; i += labelInterval) {
      const x = getX(i)
      const date = new Date(visibleData[i].epoch * 1000)
      const timeString = date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
      ctx.fillText(timeString, x, height - PADDING.bottom + 15)
    }

    if (chartType === 'Candle') {
      const availableWidth = width - PADDING.left - PADDING.right
      const spacing = availableWidth / Math.max(1, visibleData.length)
      const candleWidth = Math.max(
        MIN_CANDLE_WIDTH,
        Math.min(MAX_CANDLE_WIDTH, spacing * 0.7)
      )

      visibleData.forEach((d, i) => {
        if (!isCandle(d)) return
        const x = getX(i)
        const openY = getY(d.open)
        const closeY = getY(d.close)
        const highY = getY(d.high)
        const lowY = getY(d.low)

        const isBullish = d.close >= d.open
        ctx.strokeStyle = isBullish ? colors.bull : colors.bear
        ctx.fillStyle = isBullish ? colors.bull : colors.bear

        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x, highY)
        ctx.lineTo(x, lowY)
        ctx.stroke()

        const bodyHeight = Math.max(1, Math.abs(openY - closeY))
        ctx.fillRect(
          x - candleWidth / 2,
          Math.min(openY, closeY),
          candleWidth,
          bodyHeight
        )
      })
    } else {
      ctx.beginPath()
      visibleData.forEach((d, i) => {
        if ('price' in d) {
            const x = getX(i)
            const y = getY(d.price)
            if (i === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
        }
      })
      ctx.strokeStyle = colors.line
      ctx.lineWidth = 2
      ctx.stroke()

      const gradient = ctx.createLinearGradient(
        0,
        PADDING.top,
        0,
        height - PADDING.bottom
      )
      gradient.addColorStop(0, colors.areaTop)
      gradient.addColorStop(1, colors.areaBottom)
      ctx.fillStyle = gradient
      ctx.lineTo(getX(visibleData.length - 1), height - PADDING.bottom)
      ctx.lineTo(getX(0), height - PADDING.bottom)
      ctx.closePath()
      ctx.fill()
    }

    if (visibleIndicators.bb)
      drawBollingerBands(
        ctx,
        slicedIndicators.bollingerBands,
        colors.line,
        getY,
        getX
      )
    if (visibleIndicators.sma)
      drawLineIndicator(ctx, slicedIndicators.sma, colors.sma, getY, getX)
    if (visibleIndicators.ema)
      drawLineIndicator(ctx, slicedIndicators.ema, colors.ema, getY, getX)
    if (visibleIndicators.vwap)
      drawLineIndicator(ctx, slicedIndicators.vwap, colors.vwap, getY, getX)
    
    if (mousePosition) {
        const { x, y } = mousePosition;

        ctx.strokeStyle = colors.crosshair;
        ctx.lineWidth = 0.5;
        ctx.setLineDash([3, 3]);

        ctx.beginPath();
        ctx.moveTo(x, PADDING.top);
        ctx.lineTo(x, height - PADDING.bottom);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(PADDING.left, y);
        ctx.lineTo(width - PADDING.right, y);
        ctx.stroke();

        ctx.setLineDash([]);

        const price = getPrice(y);
        ctx.fillStyle = colors.priceBg;
        ctx.fillRect(width - PADDING.right, y - 10, Y_AXIS_WIDTH, 20);
        ctx.fillStyle = colors.text;
        ctx.fillText(price.toFixed(4), width - PADDING.right + 5, y + 4);

        const chartWidth = width - PADDING.left - PADDING.right;
        const percentX = (x - PADDING.left) / chartWidth;
        const dataIndex = Math.round(percentX * (visibleData.length - 1));
        
        if (dataIndex >= 0 && dataIndex < visibleData.length) {
            const dataPoint = visibleData[dataIndex];
            const date = new Date(dataPoint.epoch * 1000);
            const timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

            const textWidth = ctx.measureText(timeString).width;
            ctx.fillStyle = colors.priceBg;
            ctx.fillRect(x - textWidth / 2 - 5, height - PADDING.bottom, textWidth + 10, 20);
            ctx.fillStyle = colors.text;
            ctx.fillText(timeString, x - textWidth / 2, height - PADDING.bottom + 14);

            if (isCandle(dataPoint)) {
                let tooltipX = x + 15;
                let tooltipY = y + 15;
                const tooltipWidth = 120;
                const tooltipHeight = 100;

                if (tooltipX + tooltipWidth > width) tooltipX = x - tooltipWidth - 15;
                if (tooltipY + tooltipHeight > height) tooltipY = y - tooltipHeight - 15;

                ctx.fillStyle = `${colors.priceBg}E6`;
                ctx.strokeStyle = colors.grid;
                ctx.lineWidth = 1;
                ctx.fillRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);
                ctx.strokeRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);

                ctx.fillStyle = colors.text;
                ctx.font = 'bold 11px sans-serif';
                ctx.fillText(new Date(dataPoint.epoch * 1000).toLocaleString(), tooltipX + 5, tooltipY + 15);
                
                ctx.font = '11px sans-serif';
                const ohlc = [
                    `O: ${dataPoint.open.toFixed(4)}`,
                    `H: ${dataPoint.high.toFixed(4)}`,
                    `L: ${dataPoint.low.toFixed(4)}`,
                    `C: ${dataPoint.close.toFixed(4)}`,
                ];

                ohlc.forEach((text, i) => {
                    ctx.fillText(text, tooltipX + 5, tooltipY + 30 + i * 15);
                });
            }
        }
    }
  }, [
    visibleData, colors, chartType, tradeAnnotations, activeSymbol,
    drawLineIndicator, drawBollingerBands, slicedIndicators, visibleIndicators,
    mousePosition,
  ])

  const drawBrushChart = useCallback(() => {
    const canvas = brushCanvasRef.current
    if (!canvas || rawData.length === 0) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.scale(dpr, dpr)
    const width = rect.width
    const height = rect.height

    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = colors.bg
    ctx.fillRect(0, 0, width, height)

    let minPrice = Infinity
    let maxPrice = -Infinity
    rawData.forEach(d => {
      if (isCandle(d)) {
        minPrice = Math.min(minPrice, d.low)
        maxPrice = Math.max(maxPrice, d.high)
      } else if ('price' in d) {
        minPrice = Math.min(minPrice, d.price)
        maxPrice = Math.max(maxPrice, d.price)
      }
    })

    const priceRange = maxPrice - minPrice || 1
    const getY = (price: number) =>
      height - ((price - minPrice) / priceRange) * height
    const getX = (index: number) =>
      rawData.length <= 1 ? width / 2 : (index / (rawData.length - 1)) * width

    ctx.beginPath()
    rawData.forEach((d, i) => {
        const price = getDisplayPrice(d);
        const x = getX(i);
        const y = getY(price);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = colors.line
    ctx.lineWidth = 1
    ctx.stroke()

    const brushMinX = width * brushWindow.min
    const brushMaxX = width * brushWindow.max

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
    ctx.fillRect(0, 0, brushMinX, height)
    ctx.fillRect(brushMaxX, 0, width - brushMaxX, height)

    ctx.fillStyle = 'rgba(100, 150, 250, 0.1)'
    ctx.fillRect(brushMinX, 0, brushMaxX - brushMinX, height)

    ctx.strokeStyle = colors.line
    ctx.lineWidth = 2
    ctx.strokeRect(brushMinX, 0, brushMaxX - brushMinX, height)

    const handleWidth = 8
    ctx.fillStyle = colors.line
    ctx.fillRect(brushMinX - handleWidth / 2, height / 2 - 15, handleWidth, 30)
    ctx.fillRect(brushMaxX - handleWidth / 2, height / 2 - 15, handleWidth, 30)
  }, [rawData, colors, brushWindow])
  
  React.useEffect(() => {
    const animate = () => {
      drawMainChart();
      rafIdRef.current = requestAnimationFrame(animate);
    };

    if (hasActiveTrades || mousePosition) {
        if (!rafIdRef.current) {
            animate();
        }
    } else {
        drawMainChart();
        if(rafIdRef.current) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
        }
    }

    return () => {
        if (rafIdRef.current) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
        }
    };
}, [drawMainChart, hasActiveTrades, mousePosition]);

  React.useEffect(() => {
    const handleResize = () => {
      drawMainChart()
      drawBrushChart()
    }
    window.addEventListener('resize', handleResize)
    drawBrushChart()
    return () => window.removeEventListener('resize', handleResize)
  }, [drawBrushChart, drawMainChart])


  const throttleTimeoutRef = React.useRef<NodeJS.Timeout>();

  const handleBrushMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const pos = x / rect.width
    const handleMargin = 10 / rect.width

    brushRef.current.startX = pos

    if (Math.abs(pos - brushWindow.min) < handleMargin) {
      brushRef.current.target = 'min'
    } else if (Math.abs(pos - brushWindow.max) < handleMargin) {
      brushRef.current.target = 'max'
    } else if (pos > brushWindow.min && pos < brushWindow.max) {
      brushRef.current.target = 'body'
    } else {
      brushRef.current.target = ''
    }
  }, [brushWindow.min, brushWindow.max]);

  const handleBrushMouseMove = useCallback((e: React.MouseEvent) => {
    if (!brushRef.current.target) return
    if (throttleTimeoutRef.current) return;
    
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const pos = Math.max(0, Math.min(1, x / rect.width))
    const delta = pos - brushRef.current.startX

    throttleTimeoutRef.current = setTimeout(() => {
      setBrushWindow(prev => {
        let newMin = prev.min
        let newMax = prev.max

        if (brushRef.current.target === 'body') {
          const width = newMax - newMin
          newMin = Math.max(0, prev.min + delta)
          newMax = Math.min(1, newMin + width)
          if (newMax === 1) {
            newMin = 1 - width
          }
        } else if (brushRef.current.target === 'min') {
          newMin = Math.min(Math.max(0, pos), newMax - 0.01)
        } else if (brushRef.current.target === 'max') {
          newMax = Math.max(Math.min(1, pos), newMin + 0.01)
        }
        
        if (newMin !== prev.min || newMax !== prev.max) {
          return { min: newMin, max: newMax }
        }
        return prev;
      });
      brushRef.current.startX = pos;
      throttleTimeoutRef.current = undefined;
    }, 16);

  }, []);

  const handleBrushMouseUp = useCallback(() => {
    brushRef.current.target = ''
  }, []);
  
  const handleChartMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const canvas = mainCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (x >= PADDING.left && x <= rect.width - PADDING.right && y >= PADDING.top && y <= rect.height - PADDING.bottom) {
        setMousePosition({ x, y });
    } else {
        setMousePosition(null);
    }
  };

  const handleChartMouseLeave = () => {
    setMousePosition(null);
  };


  return (
    <div
      className="w-full rounded-xl p-4 relative flex flex-col aspect-video min-h-[400px]"
      style={{ backgroundColor: colors.bg }}
      ref={containerRef}
      onMouseMove={handleChartMouseMove}
      onMouseLeave={handleChartMouseLeave}
    >
      <div className="flex flex-wrap items-center justify-between gap-y-2 mb-2">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold" style={{ color: colors.text }}>
            {activeSymbol}
          </h2>
        </div>
        <div className="flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5">
                <Settings size={14} /> Indicadores
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Médias Móveis</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={visibleIndicators.sma}
                onCheckedChange={() =>
                  setVisibleIndicators(p => ({ ...p, sma: !p.sma }))
                }
              >
                SMA (Média Móvel Simples)
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleIndicators.ema}
                onCheckedChange={() =>
                  setVisibleIndicators(p => ({ ...p, ema: !p.ema }))
                }
              >
                EMA (Média Móvel Exponencial)
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleIndicators.vwap}
                onCheckedChange={() =>
                  setVisibleIndicators(p => ({ ...p, vwap: !p.vwap }))
                }
              >
                VWAP (Preço Médio Ponderado por Volume)
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Bandas</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={visibleIndicators.bb}
                onCheckedChange={() =>
                  setVisibleIndicators(p => ({ ...p, bb: !p.bb }))
                }
              >
                Bandas de Bollinger
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <ToggleGroup
            type="single"
            value={chartType}
            onValueChange={(value: ChartType) => value && setChartType(value)}
            aria-label="Tipo de Gráfico"
          >
            <ToggleGroupItem value="Area" aria-label="Gráfico de Área">
              <AreaChart size={16} />
            </ToggleGroupItem>
            <ToggleGroupItem value="Candle" aria-label="Gráfico de Velas">
              <CandlestickChart size={16} />
            </ToggleGroupItem>
          </ToggleGroup>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="h-9 w-[70px] text-xs flex items-center gap-1"
              >
                <Clock size={14} />
                {timePeriod.toUpperCase()}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-1">
              <div className="grid grid-cols-5 gap-1">
                {timePeriods.map(period => (
                  <Button
                    key={period}
                    variant={timePeriod === period ? 'default' : 'ghost'}
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => setTimePeriod(period)}
                  >
                    {period.toUpperCase()}
                  </Button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div
        className="w-full flex-1 relative"
      >
        <TradeLegend 
            annotations={tradeAnnotations}
            currentSymbol={activeSymbol}
            bgColor={colors.bg}
            textColor={colors.text}
            lineColor={colors.line}
            bullColor={colors.bull}
            bearColor={colors.bear}
        />
        {isChartLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm z-10">
            <Loader2 className="h-8 w-8 animate-spin text-white" />
          </div>
        )}
        {chartError && !isChartLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-900/50 z-10 text-white p-4 text-center">
            {chartError}
          </div>
        )}
        <canvas
          ref={mainCanvasRef}
          className="w-full h-full"
        />
      </div>
      <div className="w-full h-[60px] mt-2">
        <canvas
          ref={brushCanvasRef}
          className="w-full h-full cursor-ew-resize"
          onMouseDown={handleBrushMouseDown}
          onMouseMove={handleBrushMouseMove}
          onMouseUp={handleBrushMouseUp}
          onMouseLeave={handleBrushMouseUp}
        />
      </div>
    </div>
  )
}
