// src/features/trading/components/deriv-trader/utils/get-consensus-gradient-style.ts

export function getConsensusGradientStyle(certaintyScore: number, buttonDirection: 'rise' | 'fall') {
  const isRiseButton = buttonDirection === 'rise';
  
  const score = certaintyScore; // from -100 to 100
  const absScore = Math.abs(score);

  // Se o score é neutro, retorna um cinza.
  if (absScore < 10) {
    return { background: `hsl(220 13% 65%)`, color: 'hsl(220 13% 25%)', borderColor: `hsl(220 13% 55%)` };
  }

  // Determina se a direção do botão corresponde à direção do consenso
  const isActiveDirection = (isRiseButton && score > 0) || (!isRiseButton && score < 0);
  
  // A opacidade é alta para a direção ativa, e baixa para a inativa.
  // Ambas escalam com a força do score para dar um feedback visual.
  const alpha = isActiveDirection ? 0.6 + (absScore / 100) * 0.4 : 0.15 + (absScore / 100) * 0.1;
  
  const color = isRiseButton 
    ? `hsla(142, 71%, 45%, ${alpha})` 
    : `hsla(0, 84%, 60%, ${alpha})`;
    
  const borderColor = isRiseButton 
    ? `hsla(142, 81%, 35%, ${alpha})`
    : `hsla(0, 94%, 50%, ${alpha})`;

  return {
    background: color,
    color: 'white',
    borderColor: borderColor,
    transition: 'background 0.3s ease, border-color 0.3s ease',
  };
}
