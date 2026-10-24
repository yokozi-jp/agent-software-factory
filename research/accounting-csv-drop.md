# 会計システムへ CSV を置く先と、そのローカルの代わりを比べる

## 問い

[Issue #72](https://github.com/yokozi-jp/agent-software-factory/issues/72) の調査。サンプル機能（経費精算）の月次の締めのバッチが、会計システムへ仕訳の CSV を置く先と、そのローカルと CI での代わりを比べる。

- 置く先の候補: S3（会計システムが取りに来る）、AWS Transfer Family（SFTP）、会計システムの受け口へ HTTP で送る形
- ローカルと CI での代わりの候補: ローカルのディレクトリ、S3 互換のストレージ（MinIO、LocalStack、ほかの実装）

観点は、業務システムのファイル連携で標準とされる形（`docs/interface` との突き合わせ）、置いたファイルの完全性（件数と合計、置き終わりの合図、二重に置いたとき）、テナントごとの分け方、ローカルの代わりの版とライセンスと保守の状況。

前提は [#26 の解決のコメント](https://github.com/yokozi-jp/agent-software-factory/issues/26)（会計システムとは CSV のファイル連携、本物の SaaS にはつながずリポジトリの中のフェイクを相手にする、`tenant_id` と RLS を最初から入れる、CSV もテナントごとに置く、締めの後の取消はしない）と、`research/deploy-targets` ブランチの `research/deploy-targets.md`（デプロイ先は AWS）。調査日は 2026-10-24。

## 要約

- `docs/interface` の標準は「P2P のファイル連携は、配信側（自システム）のアカウントのバケットに置き、集信側が取りに来る」「プッシュ型の Web API 連携は採らない」。候補のうち、この標準に合うのは **S3（会計システムが取りに来る）** だけ。HTTP で送る形は `rpc-web-api.md` が密結合として退ける形にあたる。
- AWS Transfer Family（SFTP）は、会計システムが SFTP しか話せないときの手段。サーバーはプロトコルごとの時間課金（us-east-1 の例で $0.30/時、月 $216）。中断すると S3 に途中までのオブジェクトが残り得る、と公式が注意している。相手の SFTP サーバーへ送るなら SFTP connector を使う。
- S3 の PUT は原子的で、途中までのオブジェクトは作らない。読み手は成功した PUT の後なら必ず全体を読める（強い整合性）。このため「置き終わりの合図」は 1 ファイルなら要らない。CSV と別ファイルの組を置くときは、最後に置く 1 つが合図になる。
- 件数と合計は、CSV の中にトレーラー行を入れず、別ファイル（マニフェスト）に持たせるのがよい（判断）。CSV の中に入れると、`docs/interface/file-layout.md` が非推奨とするマルチレイアウトになり、RFC 4180 の CSV ではなくなる。件数と合計を持つ形は、ISO 20022 の振込依頼（`pain.001` の `NbOfTxs` と `CtrlSum`）や全銀協の形式のトレーラーと同じ考え方。
- 二重に置くことは、S3 の条件付き書き込み（`If-None-Match: *`、2024-08 に GA）で防げる。キーを「テナントと締め日」から決めれば、再実行の 2 回目は 412 で失敗し、上書きされない。バケットポリシーでこのヘッダーを必須にもできる。`docs/interface/data-consistency.md` は「配信ファイルの出力は冪等にしにくい」と書くが、この機能でその前提は変わった。`object-key-naming.md` が勧めるミリ秒のタイムスタンプと UUID をキーに入れる方法は、再実行のたびに別のファイルを作るため、締めのファイルには合わない（判断）。
- テナントは、会計システム向けのバケット（`docs/interface` の個別バケット方式）の中で、キーのプレフィックス（`tenant_id=<uuid>/`）で分けるのが標準。AWS は、テナント数が中程度ならプレフィックス、強い分離が要るならテナントごとのバケットを勧める。
- **MinIO** のコミュニティ版は保守が終わった。GitHub のリポジトリは archived で、README に「no longer maintained」とある。2025-10 からはソースだけの配布で、Docker Hub の `minio/minio` は今は取得できない（API が 404）。後継の AIStor Free は商用ライセンスで、単一ノードに限られ、再配布を禁じる。
- **LocalStack** は 2026-03-23 に 1 つのイメージにまとまった。今の版は CI を含めて auth token が要る。無料の Hobby プランは商用での利用を禁じる。GitHub のリポジトリは archived。古い版のイメージに固定すると、更新がなくなる。`docs/db/dynamodb-sdk-test.md` は LocalStack を中心のモックツールとして勧めているが、今の一次資料とは合わない。
- 今も保守されていて、Apache-2.0 で、アカウントが要らない S3 互換の実装: Adobe S3Mock（5.2.3、テスト専用）、Versity Gateway（v1.10.0、POSIX のディレクトリをそのまま S3 として出す）、SeaweedFS（4.49）、RustFS（1.0.3）、moto（5.2.4、Python）。S3Mock はタグ、条件付きの PUT、CRC64NVME のチェックサムに対応すると changelog に明記している。バケットの通知には対応しない。
- ローカルのディレクトリだけで代えると、S3 に書くコード（SDK の呼び出し、`If-None-Match`、タグ）がテストされない。CI では S3 互換の実装に対して、本番と同じ S3 のクライアントのコードを動かすのがよい（判断）。
- 判断: 置く先は S3、ローカルと CI の代わりは S3Mock か Versity Gateway が第一の候補。決めるのは [#75](https://github.com/yokozi-jp/agent-software-factory/issues/75)。

## 比較

### 置く先

| 置く先                                   | `docs/interface` との関係                                                                                | 完全性                                                              | 二重に置いたとき                                        | テナントの分け方                               | 費用の下限                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| S3（配信側のバケット、会計が取りに来る） | 合う（P2P は配信側のバケット、集信側がプル、完了はタグ）                                                 | PUT は原子的。チェックサムを S3 が検証する（既定 CRC64NVME）        | `If-None-Match: *` で 412。バケットポリシーで強制できる | キーのプレフィックスか、テナントごとのバケット | 保存とリクエストの従量だけ                        |
| AWS Transfer Family（SFTP サーバー）     | オブジェクトストレージではないため、完了はタグでなく移動かリネームになる（`file-receipt-completion.md`） | 中断すると途中までのオブジェクトが S3 に残り得る（`PARTIAL_CLOSE`） | SFTP にはない。後ろの S3 の設定に頼る（未確認）         | ユーザーごとのホームディレクトリ（未確認）     | プロトコルごとに時間課金（例: $0.30/時、月 $216） |
| Transfer Family の SFTP connector        | 相手の SFTP へ送るプッシュ型。配信側のバケットから相手の SFTP へ送る                                     | 相手のサーバーに依存する                                            | 相手のサーバーに依存する                                | 送り先の設定ごと                               | 呼び出しの回数と転送量                            |
| 会計システムの受け口へ HTTP で送る       | 合わない（プッシュ型の Web API は密結合として採らない、`rpc-web-api.md`）                                | 受け口の仕様に依存する                                              | 受け口の冪等キーに依存する                              | 受け口の仕様に依存する                         | 受け口に依存する                                  |

### ローカルと CI での代わり

| 実装                    | 版（日付）                       | ライセンス               | 保守                                       | 配布                                                     | 使う条件                                        |
| ----------------------- | -------------------------------- | ------------------------ | ------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------- |
| MinIO（コミュニティ版） | RELEASE.2025-10-15（2025-10-16） | AGPL-3.0                 | 終了（archived、「no longer maintained」） | ソースだけ。Docker Hub の `minio/minio` は 404           | 自分でビルドする。更新はない                    |
| MinIO AIStor Free       | 不明                             | 商用（無料）             | あり                                       | MinIO の配布物                                           | 単一ノード、再配布の禁止、ライセンスの取得      |
| LocalStack for AWS      | 2026.10.2（2026-10-22）          | 独自の EULA と料金プラン | あり                                       | Docker Hub `localstack/localstack`                       | auth token（CI も）。Hobby は商用での利用を禁止 |
| LocalStack（旧 OSS 版） | v4.14.0（2026-02-26）            | Apache-2.0               | 終了（archived）                           | 古いタグ                                                 | 固定した古い版。更新はない                      |
| Adobe S3Mock            | 5.2.3（2026-09-19）              | Apache-2.0               | あり（5.x が Active）                      | Docker Hub `adobe/s3mock`、Testcontainers                | なし。テスト専用、パス形式の URL だけ           |
| Versity Gateway         | v1.10.0（2026-10-22）            | Apache-2.0               | あり                                       | バイナリ、Docker Hub `versity/versitygw`                 | なし。POSIX のディレクトリを S3 として出す      |
| SeaweedFS               | 4.49（2026-10-23）               | Apache-2.0               | あり                                       | バイナリ、Docker Hub `chrislusf/seaweedfs`               | なし。分散ストレージで、テストには重い（判断）  |
| RustFS                  | 1.0.3（2026-10-17）              | Apache-2.0               | あり                                       | Docker Hub `rustfs/rustfs`                               | なし。1.0 になったばかり                        |
| moto（server mode）     | 5.2.4（2026-10-11）              | Apache-2.0               | あり                                       | PyPI、Docker                                             | Python の実行環境                               |
| Zenko CloudServer       | 9.5.0（2026-10-16）              | Apache-2.0               | あり                                       | Docker Hub の `zenko/cloudserver` は 2023 で止まっている | 今のイメージの置き場所は未確認                  |
| Garage                  | 未確認                           | AGPL-3.0                 | あり                                       | 本体は git.deuxfleurs.fr                                 | AGPL の義務の確認                               |
| ローカルのディレクトリ  | 該当なし                         | 該当なし                 | 該当なし                                   | 該当なし                                                 | S3 のコードがテストされない                     |

## 業務システムのファイル連携の標準（`docs/interface`）

`docs/interface` はフューチャー株式会社の I/F 設計ガイドライン（CC BY 4.0）を取り込んだもので、クラウドと、システムごとに独立したアカウントの間の連携を前提にする（`docs/interface/about.md`、原文 <https://future-architect.github.io/arch-guidelines/documents/forIF/if_guidelines.html>）。この問いに関わる規約は次の通り。

- 構成: 他社との連携は P2P 型になる。ハブのない P2P でも、標準的な CSV にして、バケットの所有、バケットの分離、完了の操作の推奨を守る（`file-transfer-topology.md`）。
- バケットの所有: P2P 型は原則、配信側のアカウントのバケットを使う。Web API のサーバーを提供側が持つのと同じ考え方で、集信側には参照の権限だけを与える（`object-storage-ownership.md`）。
- バケットの分離: 集信用と配信用のバケットは分ける。配信用は連携先ごとの個別バケット（`{env}-{system_name}-{outbound}-{dest}`）にする（`bucket-separation.md`）。
- キー: 連携先のコードはキーに入れない。Hive 形式で日単位以上の階層にし、業務日付を使う。ミリ秒までのタイムスタンプを付け、随時連携では UUID v7 を入れる（`object-key-naming.md`）。
- 完了の操作: 集信側はオブジェクトタグ（`processing-status` など）で取り込みの完了を示す。完了ファイル（`.complete`）はタグの下位互換で選ばない。FTP など、オブジェクトストレージでないときは移動かリネームになる（`file-receipt-completion.md`）。
- 中身: ゼロ件でもヘッダー行だけの空ファイルを置く（`file-contents.md`）。ヘッダーと明細を 1 ファイルに混ぜるマルチレイアウトは非推奨（`file-layout.md`）。CSV は RFC 4180 に従い、ヘッダー必須、UTF-8 で BOM なし、CRLF（`file-format.md`）。
- Web API: プッシュ型の Web API 連携は密結合になるため採らず、オブジェクトストレージを経由したファイル共有に切り替える。新規の I/F はファイル I/F を第一に考える（`rpc-web-api.md`）。
- 起動: 定時の連携の集信は、未着の検知のため定時に起動する（`data-freshness.md`）。

標準のやり方は「配信側のバケットに置き、集信側がプルし、タグで完了を示す」で、出典は上の各文書。避けるアンチパターンは、上流が下流のバケットやエンドポイントに依存すること（下流のリプレイスで上流に作業が出る）、集信側によるファイルの移動や削除（誤操作でオリジナルが壊れる）、他の連携先のバケットへの権限の付け足し（`object-storage-ownership.md`、`file-receipt-completion.md`、`bucket-separation.md`）。

この標準に当てはめると、経費精算が配信側、会計システムが集信側になる。会計システムのフェイクは、経費精算のアカウントのバケットから取りに来て、取り込んだらタグを付ける（判断）。

## 置く先の候補

### S3（会計システムが取りに来る）

- PUT は途中までのオブジェクトを作らない。成功の応答を受けたら、オブジェクトの全体がバケットに入っている（<https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html>）。
- PUT と DELETE は全リージョンで強い read-after-write の整合性を持つ。成功した PUT の後の GET と LIST は、書いた内容を返す。オブジェクトタグの読み取りも強い整合性。1 つのキーの更新は原子的で、途中や壊れたデータは返らない。キーをまたいだ原子的な更新はない（<https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.md> の「Amazon S3 data consistency model」）。
- 同じキーへの同時の書き込みは、最後の書き込みが勝つ（同上）。上書きを防ぐ手段として、Object Lock、`If-None-Match`、バージョニングがある（API_PutObject）。
- アップロードでは、AWS のクライアントがチェックサムを計算して送り、S3 がサーバー側で計算し直して比べてから保存する。既定のアルゴリズムは CRC64NVME（<https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.md>）。SDK は既定で、対応する操作ではリクエストのチェックサムを計算する（`request_checksum_calculation` の既定は `WHEN_SUPPORTED`。<https://docs.aws.amazon.com/sdkref/latest/guide/feature-dataintegrity.html>）。
- オブジェクトタグは 1 つのオブジェクトに 10 個まで、キーは 128 文字、値は 256 文字まで（<https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-tagging.md>）。`docs/interface` のタグの設計案（`processing-status`、`processed-timestamp`）はこの範囲に収まる。
- バケットの通知は少なくとも 1 回（at least once）届くように作られている。普通は数秒で届くが、1 分以上かかることもある（<https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventNotifications.md>）。月次の締めは定時の連携なので、`docs/interface` に従い集信側は定時に起動し、通知には頼らなくてよい（判断）。
- 別のアカウントからの読み取りは、バケットポリシーで許可できる（<https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.md> の「Bucket policy」）。

### AWS Transfer Family（SFTP）

- SFTP、FTPS、FTP、AS2、ブラウザでの転送を、S3 か EFS へのマネージドなサーバーとして提供する（<https://docs.aws.amazon.com/transfer/latest/userguide/what-is-aws-transfer-family.md>）。
- 料金は、サーバーで有効にしたプロトコルの時間課金と転送量。us-east-1 の例では SFTP が $0.30/時で、月 $216（<https://aws.amazon.com/aws-transfer-family/pricing/>）。S3 だけなら固定の費用はない。
- 転送を中断すると、Transfer Family は途中までのオブジェクトを S3 に書くことがある。公式は、中断したらサイズを確かめるよう注意している。クライアントがファイルを閉じずに切断すると、受け取った分を保存して `PARTIAL_CLOSE` のイベントを出す（<https://docs.aws.amazon.com/transfer/latest/userguide/transfer-file.md>）。S3 に直接 PUT するときの「途中のオブジェクトは作らない」性質は、SFTP を挟むと失われる。
- SFTP connector は、S3 から相手の SFTP サーバーへファイルを送る、または相手から取ってくる機能（<https://docs.aws.amazon.com/transfer/latest/userguide/creating-connectors.md>）。料金は呼び出しの回数と転送量（pricing のページ）。
- 判断: 会計システムが「SFTP で取りに来る」か「SFTP の受け口しか持たない」ときにだけ使う。サンプル機能の会計システムはリポジトリの中のフェイクで、SFTP に縛られていない。費用と、途中のファイルの扱いが増えるだけになる。

### 会計システムの受け口へ HTTP で送る形

- `docs/interface/rpc-web-api.md` は、プッシュ型の Web API 連携を密結合として採らず、オブジェクトストレージを経由したファイル共有に切り替えるよう勧める。新規の I/F はファイル I/F を第一に考える。ファイルという中間の情報があると、障害時の再処理、リプレイス時の検証、責任分界点がはっきりするため。
- 判断: #26 の決定（会計システムとは CSV のファイル連携）とも合わないため、候補から外してよい。会計システムが署名付き URL での受け取りしか用意しない、などの制約があるときに見直す。

## 置いたファイルの完全性

### 件数と合計

- CSV の中にトレーラー行（件数と合計の行）を入れると、1 つのファイルにレコードの種類が 2 つ混ざる。`docs/interface/file-layout.md` はこのマルチレイアウトを非推奨とし、`file-format.md` は RFC 4180 に従いヘッダー必須とする。RFC 4180 にはトレーラーの考えはない（<https://www.rfc-editor.org/rfc/rfc4180>）。
- 件数と合計を持つ形は、振込の標準で広く使われている。ISO 20022 の `pain.001`（振込依頼）は、Group Header に `NbOfTxs`（メッセージ全体の取引の件数、必須）と `CtrlSum`（全体の金額の合計、任意で、あれば検証される）を持つ（Goldman Sachs の実装ガイド <https://developer.gs.com/docs/services/transaction-banking/pain001details/>）。全銀協の形式も、データレコードの後にトレーラー（合計件数と合計金額）を置く（全銀協の一次資料は PDF で、今回は本文を読めていない。未確認）。
- AWS の中では、取り込む側が対象のファイルを JSON のマニフェストで受け取る形がある。Redshift の `COPY` は、マニフェストに列挙したファイルだけを読み、`mandatory` のファイルがないとエラーにする。`UNLOAD` が作るマニフェストはファイルのバイト数（`content_length`）を持つ（<https://docs.aws.amazon.com/redshift/latest/dg/loading-data-files-using-manifest.html>）。
- `docs/interface/differential-sync.md` は、チェックサムを配信ファイルからではなく、元の DB から別の経路で計算するよう勧める。作成漏れまで検証できるため。
- 判断: CSV と同じ階層に、件数、金額の合計、CSV のチェックサム（CRC64NVME か SHA-256）、締め日、テナントを持つマニフェスト（JSON）を置く。件数と合計は DB から別のクエリで数え、CSV を書いた結果とは独立にする。会計システムのフェイクは、マニフェストと CSV の中身を照らし合わせてから取り込む。ゼロ件の月も、ヘッダー行だけの CSV と件数 0 のマニフェストを置く（`file-contents.md`）。

### 置き終わりの合図

- S3 では、1 つのオブジェクトは全体が見えるか、まったく見えないかのどちらか（上記の整合性モデル）。読み手が書きかけのファイルを読む問題は、S3 に直接 PUT する限り起きない。
- 複数のオブジェクトをまとめて原子的に置く手段はない（同上の「no way to make atomic updates across keys」）。CSV とマニフェストの組では、片方だけが見える時間がある。
- `docs/interface/file-receipt-completion.md` が退ける完了ファイル（`.complete`）は、集信側の取り込み完了の印のこと。配信側の置き終わりの合図とは別の話になる。
- 判断: CSV を先に置き、マニフェストを最後に置く。集信側はマニフェストがあるものだけを取り込む。マニフェストが置き終わりの合図を兼ねる。ローカルのディレクトリや SFTP では書きかけが見えるため、一時の名前で書いてから同じファイルシステムの中でリネームする必要がある（POSIX の `rename` では、置き換える先の名前は操作の間ずっと見えていて、古いファイルか新しいファイルのどちらかを指す。<https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html>）。

### 二重に置いたとき

- S3 は 2024-08-20 から条件付き書き込みに対応した。`PutObject` と `CompleteMultipartUpload` に `If-None-Match: *` を付けると、同じキーがあれば書かない。追加の料金はない（<https://aws.amazon.com/about-aws/whats-new/2024/08/amazon-s3-conditional-writes/>）。
- 同じキーがあると 412 Precondition Failed を返す。書き込みが競合すると 409 ConditionalRequestConflict を返し、再試行するよう書かれている（API_PutObject）。`CopyObject` にも使える（<https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.md>）。
- バケットポリシーで条件キー `s3:if-none-match` を使い、ヘッダーのない書き込みを拒否できる。そのとき、そのバケットへの `CopyObject` はできなくなる（<https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.md>）。
- ローカルのファイルでは、Node.js の `'wx'` フラグ（`O_EXCL`）が同じ働きをする。パスがあれば `EEXIST` で失敗する。ネットワークのファイルシステムでは効かないことがある（<https://nodejs.org/api/fs.html> の「File system flags」）。
- 判断: キーを、締めを一意に決める値（テナント、締め日）から決める。例: `journal/tenant_id=<uuid>/dt=2026-10-31/journal_2026-10-31.csv` と同じ階層の `journal_2026-10-31.manifest.json`。再実行で 412 が返ったら、置いてあるマニフェストのチェックサムと今回の結果を比べ、同じなら成功、違えば止めて人に知らせる。#26 で締めの後の取消はしないと決めたため、同じ締めのファイルを置き直す運用は要らない。

### `docs/interface` と今の一次資料の食い違い

- `docs/interface/data-consistency.md` の「冪等性」は、配信ファイルの名前にタイムスタンプや UUID を付けるため、ファイルの出力を冪等にするのは難しいと書く。S3 の条件付き書き込み（2024-08 に GA）を使えば、決まったキーで冪等に置ける。原文はこの機能に触れていない。
- `docs/interface/object-key-naming.md` は、ミリ秒までのタイムスタンプを付けるよう勧める。締めのバッチでこれに従うと、再実行のたびに別のファイルができ、会計システムが二重に取り込む恐れがある。日付の階層（Hive 形式、業務日付）はそのまま使えるが、ファイル名は締めから決める値にする方がよい（判断）。
- `docs/db/dynamodb-sdk-test.md` は、S3 などのエミュレータとして LocalStack を使うならそれを中心のモックツールにするよう勧める。今の LocalStack は auth token が要り、無料の Hobby プランは商用での利用を禁じる（下の「LocalStack」）。
- この調査では `docs/` を直していない。直すかどうかは別に決める。

## テナントごとに分ける形

- S3 の公式は、共有のバケットでプレフィックスごとに分けるパターンと、用途ごとにバケットを分けるパターンを挙げる。共有のバケットでは、暗号化の既定やバージョニングなどがバケット単位でしか設定できず、費用の配分も難しい。バケットを分けると設定とアクセスの管理が簡単になるが、数が増える。アカウントのバケット数の既定の上限は 10,000（<https://docs.aws.amazon.com/AmazonS3/latest/userguide/common-bucket-patterns.md>）。
- AWS Storage Blog は、強い分離と単純なアクセス制御が最優先でテナント数が扱える範囲ならテナントごとのバケット、テナント数が中程度で利用者とプレフィックスの対応が固定ならプレフィックスでの分離、さらに大きいなら S3 Access Points か S3 Access Grants を勧める（<https://aws.amazon.com/blogs/storage/design-patterns-for-multi-tenant-access-control-on-amazon-s3/>、2025-01）。
- `docs/interface/bucket-separation.md` は、配信用のバケットを連携先ごとに分ける。`object-key-naming.md` は連携先のコードをキーに入れない。テナントは連携先ではないので、キーに入れてもこの規約とは食い違わない（判断）。
- 判断: 会計システム向けの配信用バケットを 1 つにし、キーの最初の階層を `tenant_id=<uuid>/` にする（Hive 形式）。会計システムのフェイクの読み取りの権限は、そのバケット全体に与える。#26 はテナント 1 つで運用すると決めたので、今はこれで足りる。テナントごとに別の会計システム（別の連携先）を持つようになったら、`bucket-separation.md` に従い、連携先ごとのバケットに分ける。
- 避けるアンチパターン: テナントを含まないキー（別のテナントの締めと同じキーになり、`If-None-Match` で失敗するか、取り込みで混ざる）、テナントをバッチの引数でなく DB の全件から推測すること（#26 の決定ではテナントごとに実行する）。

## ローカルと CI での代わり

### MinIO

- GitHub の `minio/minio` は archived で、README の冒頭に「THIS REPOSITORY IS NO LONGER MAINTAINED.」とあり、代わりに AIStor Free と AIStor Enterprise を挙げる（<https://github.com/minio/minio>、2026-10-24 取得）。
- コミュニティ版はソースだけの配布になり、コンパイル済みのバイナリは出さない。過去のバイナリは残るが更新されない。ソースからのビルドを本番で使うのは自己責任とある（同 README）。README の履歴では、2025-10-15 にソースだけの配布、2025-12-03 にメンテナンスモード、2026-02-12 に今の文面になった（GitHub API の commits）。
- 最後のリリースは `RELEASE.2025-10-15T17-29-55Z`（2025-10-16 公開。GitHub API の releases）。
- Docker Hub の `minio/minio` は、2026-10-24 に Hub の API が 404 を返し、レジストリからの pull のトークンも得られなかった（自分で確かめた結果）。今は公開のイメージとして取れない。
- MinIO の料金のページは、AGPLv3 のコミュニティ版は保守されず、新機能、バグ修正、セキュリティの修正がないと書く。AIStor は商用ライセンスで、Free は単一ノードに限り、再配布を禁じる（<https://www.min.io/pricing>）。AIStor Free の契約は、単一ノード（分散、高可用性なし）での利用だけを許す（<https://www.min.io/legal/aistor-free-agreement>）。
- 判断: リポジトリのテンプレートに入れる代わりとしては使えない。コミュニティ版は更新がなく、AIStor Free は再配布の禁止とライセンスの取得が、テンプレートを複製する使い方と合わない。

### LocalStack

- 2026-03-23 から LocalStack for AWS は 1 つのイメージにまとまり、最新の版を使うには、CI を含めて LocalStack のアカウントと auth token が要る（<https://blog.localstack.cloud/localstack-single-image-next-steps/>）。Community 版のサポートはこの日に終わった（<https://blog.localstack.cloud/2026-upcoming-pricing-changes/>）。
- auth token はコンテナの起動に必須の資格情報。個人用の Developer Token と、CI 用の CI Auth Token がある。ライセンスを確かめられないと、LocalStack は終了する。ライセンスのサーバーに届かないときはオフラインでの有効化になり、24 時間ごとに有効化し直す必要がある（<https://docs.localstack.cloud/aws/getting-started/auth-token/>）。
- 無料の Hobby プランは、旧 Community 版と同じくらいのエミュレーションを提供するが、商用での利用を禁じる。商用のソフトウェア開発には Base、Ultimate、Enterprise を使うよう案内している。CI は全プランで使えるが、フェアユースとプランの条件に従う（<https://www.localstack.cloud/pricing> の FAQ）。営利の団体が持たない OSS のプロジェクトには無料のライセンスがある（同 FAQ）。
- GitHub の `localstack/localstack` は archived。README は、旧版は Apache-2.0 だが、ダウンロードして使うと EULA に同意したことになると書く（<https://github.com/localstack/localstack>）。GitHub の最後のリリースは v4.14.0（2026-02-26）。Docker Hub の最新のタグは `2026.10.2`（2026-10-22）。
- LocalStack 自身が、古い版に固定すると AWS との差が広がり、CVE が直らず、後の移行が大きくなると書いている（上記の single-image のブログ）。
- 判断: このリポジトリの用途（業務システムのテンプレート）は商用での利用を含むため、Hobby プランでは足りない。CI にトークンの管理と外部のライセンスのサーバーへの依存が増える。S3 だけのために入れる理由はない。

### アカウントが要らず、保守されている実装

版と日付は GitHub API の releases と repos、Docker Hub の API（2026-10-24 取得）。

- **Adobe S3Mock**: Apache-2.0。5.2.3（2026-09-19）。5.x が Active。Docker イメージ（`adobe/s3mock`）か Testcontainers で動かすよう勧めている。制限として、パス形式の URL だけ、署名付き URL は検証しない、KMS は暗号化しない、本番向けではない（<https://github.com/adobe/S3Mock> の README）。操作の表で、`PutObjectTagging`、`GetObjectTagging` に対応し、バケットの通知（`PutBucketNotificationConfiguration` など）には対応しない（同 README）。changelog は、`PutObject` の条件付きリクエスト、`*` の条件、CRC64NVME のチェックサム、`CompleteMultipartUpload` での `If-None-Match` に対する 412 を挙げる（<https://github.com/adobe/S3Mock/blob/main/CHANGELOG.md>）。
- **Versity Gateway**: Apache-2.0。v1.10.0（2026-10-22）。S3 の要求を裏のストレージへの操作に変えるゲートウェイで、`posix` のバックエンドでは、ローカルのディレクトリを 1 つのコマンドで S3 のサーバーにでき、同じファイルを POSIX と S3 の両方から触れる。本番に使えると書いている。バイナリと Docker イメージ（`versity/versitygw`）がある（<https://github.com/versity/versitygw> の README）。`If-None-Match` の扱いはソースに `precondition.go` があるが、PUT での動きは確かめていない（未確認）。
- **SeaweedFS**: Apache-2.0。4.49（2026-10-23）。分散のストレージで、S3 はその機能の 1 つ（<https://github.com/seaweedfs/seaweedfs>）。
- **RustFS**: Apache-2.0。1.0.3（2026-10-17）。MinIO や Ceph との移行と共存を掲げる（<https://github.com/rustfs/rustfs>）。
- **moto**: Apache-2.0。5.2.4（2026-10-11）。Python のライブラリで、AWS のテストをモックする（<https://github.com/getmoto/moto>）。Node.js から使うには server mode を別のプロセスで動かす。
- **Zenko CloudServer**: Apache-2.0。9.5.0（2026-10-16）。Node.js の S3 の実装（<https://github.com/scality/cloudserver>）。Docker Hub の `zenko/cloudserver` は最新のタグが 2023-01 で止まっていて、今のイメージの置き場所は未確認。
- **Garage**: AGPL-3.0。本体のリポジトリは git.deuxfleurs.fr で、GitHub はミラー（<https://github.com/deuxfleurs-org/garage>）。

### ローカルのディレクトリ

- 書きかけが見える。`'wx'` で上書きは防げるが、タグ、条件付き書き込みの 412、チェックサムの検証は、自分で別に作ることになる（Node.js の fs の文書、上記）。
- 判断: S3 に書くコードを、ファイルを置く操作の境界（ポート）の裏に隠し、単体テストではメモリかディレクトリの実装を使ってよい。ただし、S3 の実装そのもの（SDK の呼び出し、`If-None-Match`、タグ、マニフェストの順序）は、S3 互換の実装に対する結合テストで確かめる。ディレクトリだけで CI を通すと、本番だけで動くコードが残る。

### 注意

- AWS の SDK は、既定で対応する操作にチェックサムを付ける（`WHEN_SUPPORTED`）。S3 互換の実装が新しいチェックサムに対応しないと、アップロードが失敗し得る。そのときは `WHEN_REQUIRED` に下げられる（<https://docs.aws.amazon.com/sdkref/latest/guide/feature-dataintegrity.html>）。S3Mock は CRC64NVME に対応する（changelog）。
- S3Mock はパス形式の URL だけに対応するため、SDK のクライアントでパス形式を有効にする（JavaScript の SDK v3 では `forcePathStyle`。<https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-s3/Interface/S3ClientConfig/>）。本番の S3 では仮想ホスト形式のままにし、環境変数で切り替える（判断）。

## 判断のまとめ

- 標準: P2P のファイル連携は、配信側のアカウントのバケットに置き、集信側がプルし、タグで完了を示す（`docs/interface` の各文書）。避けるアンチパターンは、プッシュ型の Web API、集信側によるファイルの移動や削除、上流が下流に依存する構成。
- 置く先: S3。会計システム向けの配信用バケットを 1 つ持ち、キーを `journal/tenant_id=<uuid>/dt=<締め日>/` の下に、CSV とマニフェストの組で置く。CSV を先に、マニフェストを最後に置き、どちらも `If-None-Match: *` で書く。バケットポリシーでこのヘッダーを必須にする。
- 避けるアンチパターン: CSV の中のトレーラー行（マルチレイアウト）、再実行で上書きすること、タイムスタンプだけのキーで再実行のたびに新しいファイルを作ること、書きかけが見える置き方（SFTP やディレクトリへの直接の書き込み）、件数と合計を CSV から数え直すこと（作成漏れを見逃す）。
- ローカルと CI: S3 互換の実装に、本番と同じ S3 のクライアントのコードを向ける。第一の候補は S3Mock（タグと条件付きの PUT への対応を changelog で確かめた、テスト専用）。CSV をディレクトリで見たいなら Versity Gateway（`If-None-Match` の対応は確かめてから）。
- 避けるアンチパターン: 保守の終わった MinIO のコミュニティ版や旧 LocalStack のイメージに固定すること（更新と CVE の修正がない）、商用で LocalStack の Hobby プランを使うこと、ディレクトリだけで CI を通すこと。
- 決めるのは [#75 外部システムのフェイクと CSV を置く先を決める](https://github.com/yokozi-jp/agent-software-factory/issues/75)。

## 未確認のこと

- 全銀協の形式のトレーラーとエンドレコードの正確な定義（一次資料は PDF で、本文を読めていない）。
- Versity Gateway、SeaweedFS、RustFS、Zenko CloudServer が `PutObject` の `If-None-Match` とオブジェクトタグにどこまで対応するか。ソースにヘッダーの名前はあるが、動きは確かめていない。
- Docker Hub の `minio/minio` が消えた日と理由。API の 404 を確かめただけ。
- AIStor Free の版とライセンスの取り方の詳細。
- Transfer Family の SFTP で、S3 のバケットポリシーの `s3:if-none-match` の強制がどう効くか。
- 料金は us-east-1 の例だけを見た。東京リージョンの単価は pricing のページで確かめる。

## 出典

- `docs/interface/`（about、file-transfer-topology、object-storage-ownership、bucket-separation、object-key-naming、file-receipt-completion、file-contents、file-layout、file-format、data-consistency、differential-sync、rpc-web-api、data-freshness）。原文は <https://future-architect.github.io/arch-guidelines/documents/forIF/if_guidelines.html>（CC BY 4.0）
- `docs/db/dynamodb-sdk-test.md`
- S3 PutObject: <https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html>
- S3 の整合性モデルとバケットポリシー: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.md>
- S3 の条件付き書き込み: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.md>、<https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.md>、<https://aws.amazon.com/about-aws/whats-new/2024/08/amazon-s3-conditional-writes/>（2024-08-20）
- S3 のチェックサム: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.md>、SDK の data integrity: <https://docs.aws.amazon.com/sdkref/latest/guide/feature-dataintegrity.html>
- S3 のオブジェクトタグ: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-tagging.md>
- S3 のバケットの通知: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventNotifications.md>
- S3 のバケットのパターン: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/common-bucket-patterns.md>
- マルチテナントのアクセス制御: <https://aws.amazon.com/blogs/storage/design-patterns-for-multi-tenant-access-control-on-amazon-s3/>
- Transfer Family: <https://docs.aws.amazon.com/transfer/latest/userguide/what-is-aws-transfer-family.md>、<https://docs.aws.amazon.com/transfer/latest/userguide/transfer-file.md>、<https://docs.aws.amazon.com/transfer/latest/userguide/creating-connectors.md>、<https://aws.amazon.com/aws-transfer-family/pricing/>
- Redshift のマニフェスト: <https://docs.aws.amazon.com/redshift/latest/dg/loading-data-files-using-manifest.html>
- ISO 20022 pain.001: <https://developer.gs.com/docs/services/transaction-banking/pain001details/>
- RFC 4180: <https://www.rfc-editor.org/rfc/rfc4180>
- POSIX rename: <https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html>
- Node.js fs のフラグ: <https://nodejs.org/api/fs.html>
- MinIO: <https://github.com/minio/minio>、<https://www.min.io/pricing>、<https://www.min.io/legal/aistor-free-agreement>
- LocalStack: <https://github.com/localstack/localstack>、<https://blog.localstack.cloud/localstack-single-image-next-steps/>、<https://blog.localstack.cloud/2026-upcoming-pricing-changes/>、<https://docs.localstack.cloud/aws/getting-started/auth-token/>、<https://www.localstack.cloud/pricing>
- S3Mock: <https://github.com/adobe/S3Mock>、<https://github.com/adobe/S3Mock/blob/main/CHANGELOG.md>
- Versity Gateway: <https://github.com/versity/versitygw>
- SeaweedFS: <https://github.com/seaweedfs/seaweedfs>、RustFS: <https://github.com/rustfs/rustfs>、moto: <https://github.com/getmoto/moto>、Zenko CloudServer: <https://github.com/scality/cloudserver>、Garage: <https://github.com/deuxfleurs-org/garage>
- JavaScript の SDK v3 の S3 クライアントの設定: <https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-s3/Interface/S3ClientConfig/>
