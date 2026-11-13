'use client';

/**
 * @fileOverview FOREX LAB — laboratório de PESQUISA para pares de moedas (USD como referência). Não executa ordens.
 * Mesmo método do Crypto Lab: dados importados (forexsb/Forex Strategy Builder, Dukascopy, HistData, MetaTrader, .csv ou .zip) ou baixados da Deriv, qualidade
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
import { weekendFuseDiagnostics } from '@/features/trading/services/forex-import';
import { useSkewLogger } from '@/features/trading/hooks/use-skew-logger';

const DEFAULT_PAIRS = 'EURUSD,GBPUSD,USDJPY,AUDUSD,USDCAD,USDCHF';

function ReportBox({ text, file, h = 'h-56' }: { text: string; file: string; h?: string }) {
    const { toast } = useToast();
    if (!text) return null;
    return (
        <div className="space-y-1">
            <textarea readOnly value={text} className={`w-full ${h} text-[10px] font-mono border rounded p-1`} />
            <div className="flex gap-2">
                <Button size="sm" variant="ghost" className="flex-1 border" onClick={() => { navigator.clipboard.writeText(text); toast({ title: 'Copiado!' }); }}>
                    <Copy className="h-3 w-3 mr-1.5" /> Copiar tudo
                </Button>
                <Button size="sm" variant="ghost" className="flex-1 border" onClick={() => {
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
                    a.download = file;
                    document.body.appendChild(a); a.click(); document.body.removeChild(a);
                }}>Baixar .txt</Button>
            </div>
        </div>
    );
}

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
    const [sweepPairs, setSweepPairs] = useState('EURUSD,GBPUSD,USDJPY,AUDUSD,USDCAD,USDCHF,NZDUSD');
    const [sweepDurs, setSweepDurs] = useState('15,30,60,120,240');
    const skew = useSkewLogger();
    const [skewPairs, setSkewPairs] = useState('EURUSD,GBPUSD');
    const [exclRoll, setExclRoll] = useState(true);
    const [bkP, setBkP] = useState('55');
    const [bkPay, setBkPay] = useState('89');
    const [bkBank, setBkBank] = useState('100');
    const [bkStake, setBkStake] = useState('1');

    const pairs = useMemo(() => Object.keys(lab.datasets).sort(), [lab.datasets]);
    const effectiveTarget = target && lab.datasets[target] ? target : pairs[0] ?? '';
    const d = (e: number) => new Date(e * 1000).toISOString().slice(0, 10);
    const fuse = useMemo(() => {
        const o: Record<string, { suspicious: boolean; text: string }> = {};
        Object.values(lab.datasets).forEach(x => { const w = weekendFuseDiagnostics(x.candles); o[x.pair] = { suspicious: w.suspicious, text: w.text }; });
        return o;
    }, [lab.datasets]);
    const num = (v: string, dflt: number) => { const n = Number(v.replace(',', '.')); return Number.isFinite(n) ? n : dflt; };

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
                        O método é o mesmo do Crypto Lab: 190 regras fixas (inclui famílias F "sombra" e G sessões), Holm, walk-forward, simulação de contratos. O resultado mais provável é "nenhuma regra sobrevive": isso é informação válida.
                    </CardDescription>
                </CardHeader>
            </Card>

            <div className="grid md:grid-cols-2 gap-4">
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">1a) Arquivos (forexsb FSB/MetaTrader, Dukascopy, HistData; .csv ou .zip)</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                        <input type="file" multiple accept=".csv,.zip,.txt" className="text-xs w-full" onChange={e => setFiles(Array.from(e.target.files ?? []))} />
                        <p className="text-[11px] text-muted-foreground">O par é lido do nome do arquivo (ex.: EURUSD_2026-06.csv, DAT_ASCII_EURUSD_M1_2026.zip).</p>
                        <div className="flex items-center gap-2">
                            <Label className="text-xs shrink-0">Horas para somar e chegar em UTC</Label>
                            <Input value={tz} onChange={e => setTz(e.target.value)} className="h-7 w-16 text-xs" />
                            <span className="text-[11px] text-muted-foreground">forexsb (GMT) 0 · Dukascopy 0 · HistData +5 · MetaTrader: fuso da corretora</span>
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
                                <span className={fuse[p]?.suspicious ? 'text-red-600 font-bold' : 'text-emerald-700'} title={fuse[p]?.text}>{fuse[p]?.suspicious ? 'fuso SUSPEITO' : 'fuso ok'}</span>
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
                    <label className="flex items-center gap-2 text-xs"><Checkbox checked={exclRoll} onCheckedChange={v => setExclRoll(v === true)} /> Excluir a virada de 17h NY (spread explode; recomendado)</label>
                    <Button size="sm" className="w-full bg-sky-700 text-white font-bold" disabled={lab.busy || !effectiveTarget}
                        onClick={() => lab.generateReport(refKey, effectiveTarget, exclRoll)}>
                        {lab.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Gerar SUPER RELATÓRIO FOREX'}
                    </Button>
                    <p className="text-[11px] text-muted-foreground">Cada alvo testado é uma nova rodada de ~150 hipóteses: ao testar vários alvos, o risco de falso positivo acumula (conte as rodadas).</p>
                    <p className="text-[11px] text-muted-foreground">Rodadas de hipóteses nesta sessão: {lab.rounds}.</p>
                    <ReportBox text={lab.reportText} file={`super-relatorio-forex-${effectiveTarget}.txt`} />
                </CardContent>
            </Card>
            <Card className="border-violet-300">
                <CardHeader className="pb-2"><CardTitle className="text-sm">3) Confirmação PRÉ-REGISTRADA (1 regra, 1 alvo, dados anteriores a 09/10/2026)</CardTitle>
                    <CardDescription className="text-xs">Regra C_SPREAD_z2_LIVRE_h60 (reversão do spread vs. índice do USD, 60 min) em AUDUSD; critério e janela fixados antes de ver os dados. Exige AUDUSD e ao menos 3 pares da cesta carregados; os demais pares entram como replicação exploratória.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    <Button size="sm" className="w-full bg-violet-700 text-white font-bold" disabled={lab.busy || pairs.length < 4} onClick={() => lab.runPreregistered()}>Rodar confirmação pré-registrada</Button>
                    <ReportBox text={lab.confirmText} file="confirmacao-preregistrada.txt" h="h-48" />
                </CardContent>
            </Card>

            <Card className="border-amber-300">
                <CardHeader className="pb-2"><CardTitle className="text-sm">4) Varredura de payout (proposal; NUNCA compra)</CardTitle>
                    <CardDescription className="text-xs">Pares x durações x lados (CALL, PUT, CALLE, PUTE) + dump bruto do contracts_for. Repita em horários diferentes (o payout varia).</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                        <div><Label className="text-xs">Pares</Label><Input value={sweepPairs} onChange={e => setSweepPairs(e.target.value)} className="h-7 text-xs" /></div>
                        <div><Label className="text-xs">Durações (min)</Label><Input value={sweepDurs} onChange={e => setSweepDurs(e.target.value)} className="h-7 text-xs" /></div>
                    </div>
                    <Button size="sm" variant="outline" className="w-full" disabled={lab.busy || !lab.isConnected}
                        onClick={() => lab.runSweep(sweepPairs.split(/[,\s]+/).map(x => x.trim().toUpperCase().replace(/^FRX/, '')).filter(Boolean), sweepDurs.split(/[,\s]+/).map(Number).filter(n => n > 0))}>
                        {lab.isConnected ? 'Varrer payouts' : 'Conecte-se à Deriv'}
                    </Button>
                    {lab.busy && lab.progress && <p className="text-[11px] text-muted-foreground">{lab.progress}</p>}
                    <ReportBox text={lab.sweepText} file="varredura-payout.txt" h="h-64" />
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">5) Simulador de banca (Monte Carlo; o EV por USD apostado NÃO muda com o esquema de stakes)</CardTitle>
                    <CardDescription className="text-xs">Use p = taxa de acerto de uma regra CONFIRMADA e o payout medido do lado apostado. Sem regra confirmada, p=50% mostra o custo da casa.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    <div className="grid grid-cols-4 gap-2">
                        <div><Label className="text-xs">p (%)</Label><Input value={bkP} onChange={e => setBkP(e.target.value)} className="h-7 text-xs" /></div>
                        <div><Label className="text-xs">Payout (%)</Label><Input value={bkPay} onChange={e => setBkPay(e.target.value)} className="h-7 text-xs" /></div>
                        <div><Label className="text-xs">Banca</Label><Input value={bkBank} onChange={e => setBkBank(e.target.value)} className="h-7 text-xs" /></div>
                        <div><Label className="text-xs">Stake base</Label><Input value={bkStake} onChange={e => setBkStake(e.target.value)} className="h-7 text-xs" /></div>
                    </div>
                    <Button size="sm" variant="outline" className="w-full" onClick={() => lab.runBankroll({ p: num(bkP, 50) / 100, payoutPct: num(bkPay, 89), bankroll: num(bkBank, 100), baseStake: num(bkStake, 1) })}>Simular banca</Button>
                    <ReportBox text={lab.bankrollText} file="simulador-banca.txt" h="h-48" />
                </CardContent>
            </Card>
            <Card className="border-teal-300">
                <CardHeader className="pb-2"><CardTitle className="text-sm">6) Coletor de assimetria de payout (experimento PREREG-SKEW-1; só proposal, NUNCA compra)</CardTitle>
                    <CardDescription className="text-xs">A cada 5 min (seg–sex, 08–16 UTC) grava o payout CALL/PUT de 15 e 30 min e o spot. A aba precisa ficar aberta e conectada; baixe o CSV de tempos em tempos. Hipótese única: apostar no lado de maior payout (diferença ≥ 10 pp) tem EV &gt; 0. Só analise com N ≥ 300 eventos.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    <div className="flex items-end gap-2">
                        <div className="flex-1"><Label className="text-xs">Pares (1–2 por vez)</Label><Input value={skewPairs} onChange={e => setSkewPairs(e.target.value)} className="h-7 text-xs" /></div>
                        {!skew.running
                            ? <Button size="sm" disabled={!skew.isConnected} onClick={() => skew.start(skewPairs.split(/[,\s]+/).map(x => x.trim().toUpperCase().replace(/^FRX/, '')).filter(Boolean).slice(0, 2))}>Iniciar coleta</Button>
                            : <Button size="sm" variant="destructive" onClick={() => skew.stop()}>Parar</Button>}
                    </div>
                    <p className="text-[11px] text-muted-foreground">Amostras gravadas: {skew.samples.length} · {skew.running ? 'coletando' : 'parado'} · {skew.isConnected ? 'conectado' : 'sem conexão'}</p>
                    {skew.log.length > 0 && <pre className="text-[10px] font-mono bg-muted rounded p-1 whitespace-pre-wrap">{skew.log.join('\n')}</pre>}
                    <div className="flex flex-wrap gap-2 items-center">
                        <Button size="sm" variant="outline" onClick={() => {
                            const a = document.createElement('a');
                            a.href = URL.createObjectURL(new Blob([skew.csv()], { type: 'text/csv;charset=utf-8' }));
                            a.download = `skew-payout-${new Date().toISOString().slice(0, 10)}.csv`;
                            document.body.appendChild(a); a.click(); document.body.removeChild(a);
                        }}>Baixar CSV</Button>
                        <input type="file" accept=".csv" className="text-xs" onChange={async e => { const f = e.target.files?.[0]; if (f) skew.importCsv(await f.text()); e.target.value = ''; }} />
                        <Button size="sm" variant="outline" onClick={() => skew.analyze()}>Analisar</Button>
                        <Button size="sm" variant="ghost" onClick={() => { if (window.confirm('Apagar as amostras locais? (baixe o CSV antes)')) skew.clear(); }}>Apagar local</Button>
                    </div>
                    <ReportBox text={skew.report} file="experimento-skew.txt" h="h-64" />
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
