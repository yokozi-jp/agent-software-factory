// i18next-cli lint が読む JSX の fixture (keys/hardcoded-*) を、react の型なしで型検査に通す。
declare namespace JSX {
  type Element = object;
  interface IntrinsicElements {
    p: unknown;
  }
}
