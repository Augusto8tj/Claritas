// src/features/trading/components/deriv-trader/utils/get-gradient-style.ts

/**
 * Função para gerar estilos de CSS dinâmicos para o botão "Encerrar".
 * A cor do botão muda com base no estado atual da operação (ganhando, perdendo ou empatando).
 * 
 * @param {object} props - Propriedades para determinar o estilo.
 * @param {boolean} props.isWinning - Se a operação está atualmente com lucro.
 * @param {boolean} props.isEven - Se a operação está no ponto de entrada (sem lucro/perda).
 * @returns {React.CSSProperties} Um objeto de estilo CSS para ser aplicado ao botão.
 */
export function getGradientStyle({
  isWinning,
  isEven,
}: {
  isWinning: boolean;
  isEven: boolean;
}) {

  // ESTADO NEUTRO: Se o preço estiver igual ao de entrada.
  if (isEven) {
    return {
        background: "#64748b", // Cor: Cinza (Slate-500)
        color: "#fff",
        boxShadow: "none",
        borderColor: "#475569"
    };
  }

  // ESTADO DE GANHO: Se a operação estiver com lucro.
  if (isWinning) {
    return {
      background: `linear-gradient(135deg, #22c55e, #15803d)`, // Cor: Gradiente verde (Green-500 a Green-700)
      color: "#fff",
      boxShadow: `0 0 10px rgba(34, 197, 94, 0.6)`, // Efeito de brilho verde
      borderColor: "#166534",
    };
  } else {
    // ESTADO DE PERDA: Se a operação estiver com prejuízo.
    return {
      background: `linear-gradient(135deg, #ef4444, #b91c1c)`, // Cor: Gradiente vermelho (Red-500 a Red-700)
      color: "#fff",
      boxShadow: `0 0 10px rgba(239, 68, 68, 0.6)`, // Efeito de brilho vermelho
      borderColor: "#991b1b",
    };
  }
}
