// Not a module of the sample feature: a package in the shape of a module, with its layers (domain/, application/,
// infrastructure/, http/), that holds the detection-power fixtures (#43) of the lint overrides that reach every
// module (docs/adr/0026). The fixtures are in __fixtures__/ of each layer. The package stays when the sample
// feature is removed, so the sensors stay too. It exports nothing, and nothing depends on it.
export {};
