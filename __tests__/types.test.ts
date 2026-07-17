import { execSync } from 'child_process';
import * as path from 'path';

describe('type safety', () => {
  it('should pass type checking (tsc --noEmit)', () => {
    const root = path.resolve(__dirname, '..');
    try {
      execSync('npx tsc --noEmit', { cwd: root, stdio: 'ignore' });
    } catch (e: any) {
      const status = typeof e?.status === 'number' ? ` (exit code: ${e.status})` : '';
      throw new Error(`Type checking failed${status}`);
    }
  });
});
