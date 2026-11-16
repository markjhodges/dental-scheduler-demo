import { assertSynthetic } from '@/lib/db';
import { SyntheticPracticeSystem } from './synthetic';
import type { PracticeSystem } from './practice-system';

export function practiceSystem(): PracticeSystem {
  assertSynthetic();
  return new SyntheticPracticeSystem();
}
