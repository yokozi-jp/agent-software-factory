# Coding standards

レビューの agent (`code-review` skill の Standards の観点) が読む、判断の規則です。
機械で判定できる規則は、ここに書かずに検査にします。`vp check`、`scripts/docs-check.sh`、`scripts/check-repo-policy.sh`、markdownlint が止めるものは、レビューで指摘しません。

## docs の事実と出典

docs の事実を足すか変える文は、一次情報 (仕様、RFC、公式ドキュメント、標準化団体の文書) を出典に挙げ、その出典の本文と合っています。

- 出典の本文を読み、文が言っていることが本文に書いてあるかを確かめます。別の節の内容を混ぜた文や、出典より強く言い切った文は、違反として指摘します。
- caniuse、ブログ、Qiita、Zenn、Medium、Stack Overflow、製品の宣伝のページは、出典にしません。
- 出典がない判断は、判断だと書きます。
- 出典の読み方は `docs/tooling/external-docs.md` にあります。

## 決定と docs の食い違い

ADR を足すか変える変更は、その決定と食い違う docs を同じ変更で直します。

- ADR が否定する語 (たとえば ADR 0010 なら `develop`、`hotfix`、`release` ブランチ) で `docs/` を探し、残っている記述を指摘します。リンク先だけを見ると、本文の前提が残ります。
- 取り込んだガイドラインを直したら、その領域の `about.md` の「原文からの変更点」に、何をどの根拠で変えたかが書いてあります。`about.md` も変えたかは pre-commit (`scripts/docs-check.sh staged`) が見ますが、書いた行が変更と合っているかはレビューで見ます。

## 文体

- このリポジトリの文書は「です・ます」、取り込んだガイドライン (`about.md` がある領域) は「だ・である」で書きます。直した箇所が、まわりの文体と揃っているかを見ます。
