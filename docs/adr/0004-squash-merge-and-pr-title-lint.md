# PR は squash merge だけにし、PR タイトルを Conventional Commits で検証する

main の履歴は `nx release` がバージョンと CHANGELOG を決めるための入力なので、main の全コミットが Conventional Commits に従っている必要があります。squash merge では PR タイトルがそのまま main のコミットメッセージになるので、PR タイトルを CI の commitlint で検証するのが一番確実です。PR 内の各コミットも検証しますが、ローカルの hook は `--no-verify` で飛ばせるので、最後の関門は PR タイトルの検証です。merge commit と rebase merge は無効にします (設定手順は docs/development-setup.md の「GitHub リポジトリの設定」)。
