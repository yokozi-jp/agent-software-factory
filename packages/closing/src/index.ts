// The public API of the 締め (closing) module. Other packages import only this file, by the package name.
// closing may import approval and claim: modules depend one way, closing → approval → claim (docs/adr/0026).
// The layers are domain/, application/, infrastructure/ and http/. This file wires them together and exports
// what apps/api assembles. The module has no code yet.
export {};
