// `./node` の入口 (docs/adr/0048、docs/adr/0054)。再 export だけを書く。中身は infrastructure/ にある。
export * from "./infrastructure/sdk.ts";
