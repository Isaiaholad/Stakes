import { webcrypto } from 'node:crypto';
import '@testing-library/jest-dom/vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    disconnect() {}
    observe() {}
    unobserve() {}
  };
}
