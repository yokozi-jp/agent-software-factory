// `./client` の入口 (docs/adr/0052、docs/adr/0054)。再 export だけを書く。中身は infrastructure/ にある。
export { createHrSystemClient } from "./infrastructure/client.ts";
