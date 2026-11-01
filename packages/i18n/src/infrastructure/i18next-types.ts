// react-i18next と `t` のキーの型は、i18next の CustomTypeOptions の augmentation で決まる。augmentation はこのファイルを
// 読む program の全体に効くので、index.ts が型だけ import し、web もこの package を import すれば届く。
import type { defaultNamespace, resources } from "./resources.ts";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNamespace;
    // 文言のキーの型は、基準の言語 (ja) のリソースから作る。
    resources: (typeof resources)["ja"];
  }
}
