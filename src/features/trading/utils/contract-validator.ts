// src/features/trading/utils/contract-validator.ts
/**
 * Validador de Contratos de Dígitos
 * Valida resultados localmente para garantir precisão matemática
 */

export interface ValidationResult {
    isWin: boolean;
    lastDigit: number;
    expected: string;
    reasoning: string;
}

export interface ContractValidationLog {
    contractId: number;
    contractType: string;
    barrier?: number;
    exitPrice: number;
    exitTickEpoch: number;
    apiStatus: 'won' | 'lost';
    localStatus: 'won' | 'lost';
    isDivergent: boolean;
    validation: ValidationResult;
    timestamp: string;
}

/**
 * Extrai o último dígito de um preço baseado em casas decimais
 */
export const extractLastDigit = (price: number, decimalPlaces: number): number => {
    if (!Number.isFinite(price) || isNaN(price)) {
        console.warn(`[Validator] Preço inválido: ${price}`);
        return 0;
    }
    const priceString = price.toFixed(decimalPlaces);
    const lastDigit = parseInt(priceString.slice(-1), 10);
    return isNaN(lastDigit) ? 0 : lastDigit;
};

/**
 * Valida se um contrato de dígito deveria ter ganho/perdido matematicamente
 */
export const validateDigitContract = (
    contractType: string,
    barrier: number | undefined,
    exitPrice: number,
    decimalPlaces: number = 2
): ValidationResult => {
    const lastDigit = extractLastDigit(exitPrice, decimalPlaces);
    let isWin = false;
    let expected = '';
    let reasoning = '';

    switch (contractType) {
        case 'DIGITMATCH':
            isWin = lastDigit === barrier;
            expected = `dígito exato ${barrier}`;
            reasoning = `Dígito ${lastDigit} ${isWin ? '===' : '!=='} ${barrier}`;
            break;

        case 'DIGITDIFF':
            isWin = lastDigit !== barrier;
            expected = `diferente de ${barrier}`;
            reasoning = `Dígito ${lastDigit} ${isWin ? '!==' : '==='} ${barrier}`;
            break;

        case 'DIGITOVER':
            const overBarrier = barrier ?? 4; // Corrigido para 4
            isWin = lastDigit > overBarrier;
            expected = `> ${overBarrier}`;
            reasoning = `Dígito ${lastDigit} ${isWin ? '>' : '<='} ${overBarrier}`;
            break;

        case 'DIGITUNDER':
            const underBarrier = barrier ?? 5; // Corrigido para 5
            isWin = lastDigit < underBarrier;
            expected = `< ${underBarrier}`;
            reasoning = `Dígito ${lastDigit} ${isWin ? '<' : '>='} ${underBarrier}`;
            break;

        case 'DIGITEVEN':
            isWin = lastDigit % 2 === 0;
            expected = 'par';
            reasoning = `Dígito ${lastDigit} é ${isWin ? 'par' : 'ímpar'}`;
            break;

        case 'DIGITODD':
            isWin = lastDigit % 2 !== 0;
            expected = 'ímpar';
            reasoning = `Dígito ${lastDigit} é ${isWin ? 'ímpar' : 'par'}`;
            break;

        default:
            console.error(`[Validator] Tipo de contrato desconhecido: ${contractType}`);
            reasoning = `Tipo desconhecido: ${contractType}`;
    }

    return { isWin, lastDigit, expected, reasoning };
};

/**
 * Valida e registra divergências entre API e cálculo local
 */
export const validateAndLogContract = (
    contractId: number,
    contractType: string,
    barrier: number | undefined,
    exitPrice: number,
    exitTickEpoch: number,
    apiStatus: 'won' | 'lost',
    decimalPlaces: number = 2
): ContractValidationLog => {
    const validation = validateDigitContract(contractType, barrier, exitPrice, decimalPlaces);
    const localStatus = validation.isWin ? 'won' : 'lost';
    const isDivergent = apiStatus !== localStatus;

    const log: ContractValidationLog = {
        contractId,
        contractType,
        barrier,
        exitPrice,
        exitTickEpoch,
        apiStatus,
        localStatus,
        isDivergent,
        validation,
        timestamp: new Date().toISOString(),
    };

    if (isDivergent) {
        console.error('🚨 DIVERGÊNCIA DETECTADA!', {
            contractId,
            contractType,
            barrier,
            exitPrice: exitPrice.toFixed(decimalPlaces),
            lastDigit: validation.lastDigit,
            apiSays: apiStatus,
            mathSays: localStatus,
            reasoning: validation.reasoning,
        });
    } else {
        console.log('✅ Validação OK:', {
            contractId,
            result: localStatus,
            reasoning: validation.reasoning,
        });
    }

    return log;
};
