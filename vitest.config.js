/**
 * Vitest 설정 — 통합 테스트는 단일 스레드 직렬 실행 (DB 충돌 방지).
 *
 * - `npm test`         : 한 번 실행
 * - `npm run test:watch` : 파일 변경 감지 모드
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    globalSetup: ['./tests/global-setup.mjs'],
    testTimeout: 30000,
    hookTimeout: 15000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    environment: 'node',
    reporters: ['default'],
    globals: false
  }
});
