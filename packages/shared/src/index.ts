// The public API of shared: code that the modules of the sample feature share, such as types. shared imports no
// module (docs/adr/0026). Other packages import only this file, by the package name.
export type { Result } from "./result.ts";
