// Vitest の browser mode の setup (vite.config.ts)。Safari と iOS は組み込みの Temporal を持たないので、web は
// 入口 (src/main.tsx) と同じ polyfill の global を入れる。
import "temporal-polyfill/global";
