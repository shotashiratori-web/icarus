import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// globals:trueを使わないため（vitest.config.tsを最小構成に保つ）、RTLの自動cleanupが
// 効かない。各testごとにDOMを明示的にunmountし、render()の蓄積による誤検出を防ぐ
afterEach(() => {
  cleanup();
});
