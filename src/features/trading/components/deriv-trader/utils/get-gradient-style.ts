// src/features/trading/components/deriv-trader/utils/get-gradient-style.ts

export function getGradientStyle({
  isWinning,
  isEven,
}: {
  isWinning: boolean;
  isEven: boolean;
}) {

  if (isEven) {
    return {
        background: "#64748b", // Slate-500 (Cinza neutro)
        color: "#fff",
        boxShadow: "none",
        borderColor: "#475569"
    };
  }

  if (isWinning) {
    // Verde (Win)
    return {
      background: `linear-gradient(135deg, #22c55e, #15803d)`, // Green-500 para Green-700
      color: "#fff",
      boxShadow: `0 0 10px rgba(34, 197, 94, 0.6)`, // Brilho verde
      borderColor: "#166534",
    };
  } else {
    // Vermelho (Loss)
    return {
      background: `linear-gradient(135deg, #ef4444, #b91c1c)`, // Red-500 para Red-700
      color: "#fff",
      boxShadow: `0 0 10px rgba(239, 68, 68, 0.6)`, // Brilho vermelho
      borderColor: "#991b1b",
    };
  }
}
