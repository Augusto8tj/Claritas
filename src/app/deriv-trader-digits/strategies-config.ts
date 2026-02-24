// src/app/deriv-trader-digits/strategies-config.ts
'use client';

/**
 * @fileOverview Módulo de Configuração Central para Estratégias de Dígitos.
 * Este arquivo cataloga todas as estratégias de trading de dígitos implementadas,
 * seus parâmetros e as configurações globais de risco. Serve como uma "fonte da verdade"
 * para a lógica do robô, facilitando a manutenção e futuras otimizações.
 */

// ============================================================================
// 1. TIPOS E INTERFACES
// ============================================================================

// O `PilotType` deve corresponder exatamente às chaves do estado `pilots` no hook `useRobotCouncilDigits`.
export type PilotType = 'matchesDiffers' | 'overUnder' | 'evenOdd' | 'underdog' | 'underdogOverUnder' | 'dynamicUnderdogOverUnder' | 'underdogEvenOdd' | 'vagalume';

export type DigitContractType =
  | 'DIGITMATCH'
  | 'DIGITDIFF'
  | 'DIGITEVEN'
  | 'DIGITODD'
  | 'DIGITOVER'
  | 'DIGITUNDER';

/**
 * Define a estrutura para uma única estratégia de trading de dígitos.
 */
export interface DigitStrategyDefinition {
  id: PilotType;
  name: string;
  description: string;
  contractTypes: DigitContractType[] | ['MULTI'];
  // Mapeia para a variável de estado em `useRobotCouncilDigits` que controla o limiar desta estratégia.
  paramKey:
    | 'consensusThreshold'
    | 'overUnderThreshold'
    | 'evenOddThreshold'
    | 'underdogThreshold'
    | 'overUnderUnderdogThreshold'
    | 'evenOddUnderdogThreshold'
    | null; // Usado para estratégias que não possuem um limiar de usuário direto.
  // Mapeia outros parâmetros de configuração específicos da estratégia.
  otherParams?: {
      isInverseKey?: 'isUnderdogInverse';
  }
}

// ============================================================================
// 2. DEFINIÇÕES DAS ESTRATÉGIAS
// ============================================================================

/**
 * Este array mapeia as estratégias de "pilotos" existentes no hook `useRobotCouncilDigits.ts`
 * para uma estrutura de configuração padronizada.
 */
export const STRATEGY_DEFINITIONS: DigitStrategyDefinition[] = [
  // 1. Estratégia principal de "Difere" baseada no consenso de múltiplas janelas.
  {
    id: 'matchesDiffers',
    name: 'Contra-Tendência (Difere)',
    description: "Aposta 'Difere' no dígito mais frequente, assumindo uma regressão à média. Usa um consenso de múltiplas janelas de tempo.",
    contractTypes: ['DIGITDIFF'],
    paramKey: 'consensusThreshold',
  },
  // 2. Estratégia padrão para Acima/Abaixo.
  {
    id: 'overUnder',
    name: 'Acima/Abaixo (Padrão)',
    description: "Analisa a probabilidade combinada dos dígitos serem maiores que 4 ou menores que 5.",
    contractTypes: ['DIGITOVER', 'DIGITUNDER'],
    paramKey: 'overUnderThreshold',
  },
  // 3. Estratégia padrão para Par/Ímpar.
  {
    id: 'evenOdd',
    name: 'Par/Ímpar (Padrão)',
    description: "Analisa a probabilidade combinada do próximo dígito ser par ou ímpar.",
    contractTypes: ['DIGITEVEN', 'DIGITODD'],
    paramKey: 'evenOddThreshold',
  },
  // 4. Estratégia de "azarão" que aposta no dígito menos frequente.
  {
    id: 'underdog',
    name: 'Caçador de Azarão (Combina)',
    description: "Aposta 'Combina' no dígito menos frequente ('frio'), explorando a regressão à média. Pode ser invertido para apostar 'Difere'.",
    contractTypes: ['DIGITMATCH', 'DIGITDIFF'],
    paramKey: 'underdogThreshold',
    otherParams: {
      isInverseKey: 'isUnderdogInverse'
    }
  },
  // 5. Estratégia de "azarão" para blocos Acima/Abaixo.
  {
    id: 'underdogOverUnder',
    name: 'Azarão de Bloco Acima/Abaixo',
    description: "Aposta no bloco (0-4 ou 5-9) que está estatisticamente 'atrasado' em aparecer.",
    contractTypes: ['DIGITOVER', 'DIGITUNDER'],
    paramKey: 'overUnderUnderdogThreshold',
  },
  // 6. Estratégia dinâmica que não possui um limiar de usuário direto.
  {
    id: 'dynamicUnderdogOverUnder',
    name: 'Azarão de Bloco Dinâmico',
    description: "Analisa a composição dos 5 dígitos menos prováveis para apostar no bloco oposto, usando um consenso de janelas de tempo.",
    contractTypes: ['DIGITOVER', 'DIGITUNDER'],
    paramKey: null,
  },
  // 7. Estratégia de "azarão" para blocos Par/Ímpar.
  {
    id: 'underdogEvenOdd',
    name: 'Azarão de Bloco Par/Ímpar',
    description: "Aposta no bloco (Par ou Ímpar) que está estatisticamente 'atrasado'.",
    contractTypes: ['DIGITEVEN', 'DIGITODD'],
    paramKey: 'evenOddUnderdogThreshold',
  },
  // 8. Nova estratégia Vagalume
  {
    id: 'vagalume',
    name: 'Vagalume Alternante',
    description: 'Estratégia de meta-aprendizagem que explora a alternância de vitória/derrota (W-L-W-L).',
    contractTypes: ['MULTI'], // Indica que pode usar vários tipos de contrato
    paramKey: null, // Parâmetros gerenciados por seu próprio hook
  },
];

// Adicionado para mapear IDs de estratégia a nomes legíveis para a UI.
export const strategyLabels: Record<string, string> =
  STRATEGY_DEFINITIONS.reduce((acc, strategy) => {
    acc[strategy.id] = strategy.name;
    return acc;
  }, {} as Record<string, string>);

// ============================================================================
// 3. CONFIGURAÇÕES GLOBAIS DE RISCO E MARTINGALE
// ============================================================================

// Estes parâmetros também são encontrados em `useRobotCouncilDigits.ts` e controlam o comportamento geral.

export interface GlobalRiskConfig {
  dailyBalance: number;
  dailyTarget: number;
  executionCooldown: number;
}

export interface MartingaleConfig {
  isEnabled: boolean;
  isSmart: boolean;
  recoveryFactor: number;
  maxLosses: number;
  cooldownTime: number;
}

/**
 * Valores padrão para as configurações de risco globais, espelhando os valores
 * iniciais no hook `useRobotCouncilDigits.ts`.
 */
export const DEFAULT_GLOBAL_RISK_CONFIG: GlobalRiskConfig = {
    dailyBalance: 10,
    dailyTarget: 5,
    executionCooldown: 1,
};

/**
 * Valores padrão para as configurações do Martingale, espelhando os valores
 * iniciais no hook `useRobotCouncilDigits.ts`.
 */
export const DEFAULT_MARTINGALE_CONFIG: MartingaleConfig = {
    isEnabled: true,
    isSmart: true,
    recoveryFactor: 1.3,
    maxLosses: 5,
    cooldownTime: 5,
};
