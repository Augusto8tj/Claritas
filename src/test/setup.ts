// src/test/setup.ts
import '@testing-library/jest-dom';

// Mock performance.now() para ambientes de teste
if (typeof global.performance === 'undefined') {
  global.performance = {
    now: () => Date.now(),
  } as any;
}
