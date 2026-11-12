'use client';

/**
 * @fileOverview FOREX LAB — laboratório de PESQUISA para pares de moedas (USD como referência). Não executa ordens.
 * Mesmo método do Crypto Lab: dados importados (Dukascopy/HistData/MetaTrader, .csv ou .zip) ou baixados da Deriv, qualidade
 * dos dados, 150 regras pré-registradas com Holm, walk-forward com holdout, simulação de Rise/Fall e Multiplier, e sondas
 * de payout/custo (proposal, nunca compra) — tudo em UM relatório para copiar.
 */
import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Copy, Loader2, ShieldCheck, Globe } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { DerivApiProviderV2 as DerivApiProvider } from '@/features/trading/hooks/use-deriv-api-v2';
import { ApiStatusIndicatorV2 as ApiStatusIndicator } from '@/features/trading/components/deriv-trader/ApiStatusIndicatorV2';
import { useForexLab, USD_INDEX } from '@/features/trading/hooks/use-forex-lab';

const DEFAULT_PAIRS = 'EURUSD,GBPUSD,USDJPY,AUDUSD,USDCAD,USDCHF';

function ForexLabContent() {
    const { toast } = useToast();
    const lab = useForexLab();
    const [files, setFiles] = useState<File[]>([]);
    const [tz, setTz] = useState('0');
    const [fillGaps, setFillGaps] = useState(true);
    const [pairsText, setPairsText] = useState(DEFAULT_PAIRS);
    const [count, setCount] = useState('40000');
    const [refKey, setRefKey] = useState(USD_INDEX);
    const [target, setTarget] = useState('');
    const [durationMin, setDurationMin] = useState('15');

    const pairs = useMemo(() => Object.keys(lab.datasets).sort(), [lab.datasets]);
    const effectiveTarget = target && lab.datasets[target] ? target : pairs[0] ?? '';
    const d = (e: number) => new Date(e * 1000).toISOString().slice(0, 10);

    return (
        <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                    <Globe className="h-6 w-6 text-sky-600" />
                    <h1 className="text-xl font-bold">Forex Lab (pesquisa)</h1>
                    <Badge variant="outline" className="border-sky-300 text-sky-700">Sem execução de ordens</Badge>
                </div>
                <ApiStatusIndicator />
            </div>

            <Card className="border-sky-200">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Como usar</CardTitle>
                    <CardDescription className="text-xs">
                        1) Carregue velas de 1 min (arquivos ou Deriv). 2) Escolha referência (índice do USD ou um par) e alvo. 3) Rode as sondas (payout e custo do Multiplier) e gere o relatório. Cole o relatório único no chat.
                        O método é o mesmo do Crypto Lab: 150 regras fixas, Holm, walk-forward, simulação de contratos. O resultado mais provável é "nenhuma regra sobrevive": isso é informação válida.
                    </CardDescription>
                </CardHeader>
            </Card>

            <div className="grid md:grid-cols-2 gap-4">
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">1a) Arquivos (Dukascopy, HistData, MetaTrader; .csv ou .zip)</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                        <input type="file" multiple accept=".csv,.zip,.txt" className="text-xs w-full" onChange={e => setFiles(Array.from(e.target.files ?? []))} />
                        <p className="text-[11px] text-muted-foreground">O par é lido do nome do arquivo (ex.: EURUSD_2026-06.csv, DAT_ASCII_EURUSD_M1_2026.zip).</p>
                        <div className="flex items-center gap-2">
                            <Label className="text-xs shrink-0">Horas para somar e chegar em UTC</Label>
                            <Input value={tz} onChange={e => setTz(e.target.value)} className="h-7 w-16 text-xs" />
                            <span className="text-[11px] text-muted-foreground">Dukascopy 0 · HistData +5 · MetaTrader: fuso da corretora (negativo se adiantado)</span>
                        </div>
                        <label className="flex items-center gap-2 text-xs"><Checkbox checked={fillGaps} onCheckedChange={v => setFillGaps(v === true)} /> Preencher buracos de até 5 min (velas planas)</label>
                        <Button size="sm" className="w-full" disabled={lab.busy || files.length === 0} onClick={() => lab.loadFiles(files, { tzOffsetHours: Number(tz) || 0, fillGaps })}>
                            {lab.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Carregar arquivos'}
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">1b) Baixar da Deriv (~28 dias de 1 min por par)</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                        <Input value={pairsText} onChange={e => setPairsText(e.target.value)} className="h-8 text-xs" />
                        <div className="flex items-center gap-2">
                            <Label className="text-xs">Velas por par</Label>
                            <Input value={count} onChange={e => setCount(e.target.value)} className="h-7 w-24 text-xs" />
                        </div>
                        <Button size="sm" variant="outline" className="w-full" disabled={lab.busy || !lab.isConnected}
                            onClick={() => lab.downloadFromDeriv(pairsText.split(/[,\s]+/).map(s => s.trim().toUpperCase().replace(/^FRX/, '')).filter(Boolean), Math.max(1000, Number(count) || 40000), fillGaps)}>
                            {lab.isConnected ? 'Baixar da Deriv' : 'Conecte-se à Deriv para baixar'}
                        </Button>
                        {lab.busy && lab.progress && <p className="text-[11px] text-muted-foreground">{lab.progress}</p>}
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Dados carregados</CardTitle></CardHeader>
                <CardContent className="space-y-1">
                    {pairs.length === 0 && <p className="text-xs text-muted-foreground">Nenhum par carregado.</p>}
                    {pairs.map(p => {
                        const x = lab.datasets[p], q = x.quality;
                        return (
                            <div key={p} className="text-xs flex flex-wrap gap-x-3 border-b py-1">
                                <b>{p}</b>
                                <span>{q.n} velas</span><span>{d(q.from)} a {d(q.to)}</span>
                                <span>buracos: {q.gaps} (faltam {q.missingMinutes} min)</span>
                                <span>planas: {(q.flatShare * 100).toFixed(1)}%</span>
                                <span>{x.source}{x.filled ? ` · preenchidas ${x.filled}` : ''}</span>
                            </div>
                        );
                    })}
                    {lab.messages.length > 0 && <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap pt-1">{lab.messages.join('\n')}</pre>}
                </CardContent>
            </Card>

            <Card className="border-sky-300">
                <CardHeader className="pb-2"><CardTitle className="text-sm">2) Configurar e gerar</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <Label className="text-xs">Referência</Label>
                            <select className="w-full border rounded h-8 text-xs" value={refKey} onChange={e => setRefKey(e.target.value)}>
                                <option value={USD_INDEX}>Índice do USD (cesta sem o alvo)</option>
                                {pairs.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                        </div>
                        <div>
                            <Label className="text-xs">Alvo</Label>
                            <select className="w-full border rounded h-8 text-xs" value={effectiveTarget} onChange={e => setTarget(e.target.value)}>
                                {pairs.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Label className="text-xs shrink-0">Duração do Rise/Fall a sondar (min)</Label>
                        <Input value={durationMin} onChange={e => setDurationMin(e.target.value)} className="h-7 w-16 text-xs" />
                        <Button size="sm" variant="outline" disabled={lab.busy || !lab.isConnected || !effectiveTarget} onClick={() => lab.runProbes(effectiveTarget, Number(durationMin) || 15)}>
                            Sondar payout e custo do Multiplier (sem comprar)
                        </Button>
                    </div>
                    <Button size="sm" className="w-full bg-sky-700 text-white font-bold" disabled={lab.busy || !effectiveTarget}
                        onClick={() => lab.generateReport(refKey, effectiveTarget)}>
                        {lab.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Gerar SUPER RELATÓRIO FOREX'}
                    </Button>
                    <p className="text-[11px] text-muted-foreground">Cada alvo testado é uma nova rodada de ~150 hipóteses: ao testar vários alvos, o risco de falso positivo acumula (conte as rodadas).</p>
                    {lab.reportText && (
                        <div className="space-y-1">
                            <textarea readOnly value={lab.reportText} className="w-full h-56 text-[10px] font-mono border rounded p-1" />
                            <div className="flex gap-2">
                                <Button size="sm" variant="ghost" className="flex-1 border" onClick={() => { navigator.clipboard.writeText(lab.reportText); toast({ title: 'Relatório copiado!' }); }}>
                                    <Copy className="h-3 w-3 mr-1.5" /> Copiar tudo
                                </Button>
                                <Button size="sm" variant="ghost" className="flex-1 border" onClick={() => {
                                    const a = document.createElement('a');
                                    a.href = URL.createObjectURL(new Blob([lab.reportText], { type: 'text/plain;charset=utf-8' }));
                                    a.download = `super-relatorio-forex-${effectiveTarget}.txt`;
                                    document.body.appendChild(a); a.click(); document.body.removeChild(a);
                                }}>Baixar .txt</Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

export default function ForexLabPage() {
    return (
        <DerivApiProvider>
            <ForexLabContent />
        </DerivApiProvider>
    );
}
