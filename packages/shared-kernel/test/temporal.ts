// Vitest の setup (vite.config.ts)。Node.js 24 には Temporal がないので、polyfill の global を入れる。
// Node.js 26 以降は組み込みの Temporal を使い、この import は何もしない。
import "temporal-polyfill/global";
