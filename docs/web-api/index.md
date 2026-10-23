# Web API設計

- [出典と適用範囲](about.md)：これらの規約がどの Web API に適用されるかを確かめるとき、出典やライセンスを確かめるとき
- [Web API のアーキテクチャ選定とリソース設計](url-and-resource-design.md)：API の方式 (REST/gRPC/GraphQL) を選ぶとき、ホスト名やパス、リソースの形を決めるとき
- [Web API のバージョニングと廃止](versioning.md)：破壊的変更を伴う更新を計画するとき、API を廃止するとき
- [Web API の HTTP メソッドの選択](http-methods.md)：エンドポイントの HTTP メソッドを決めるとき
- [Web API の冪等性と PATCH の部分更新](idempotency-and-patch.md)：リトライ時の重複処理を防ぐとき、PATCH のボディ形式を決めるとき
- [Web API のリクエスト設計](request-design.md)：リクエストヘッダー、クエリパラメータ、リクエストボディを設計するとき
- [Web API の HTTP ステータスコード](status-codes.md)：レスポンスのステータスコードを選ぶとき
- [Web API のレスポンスボディ](response-body.md)：レスポンスの JSON の形式やエラー形式を設計するとき
- [Web API のレスポンスヘッダー](response-headers.md)：レスポンスヘッダーやキャッシュ制御を設計するとき
- [Web API のバリデーションと区分値取得 API](validation-and-code-values.md)：入力チェックの配置を決めるとき、区分値の持ち方を決めるとき
- [Web API の排他制御（楽観ロック）](exclusive-control.md)：同時更新の整合性を設計するとき
- [Web API のファイル連携](file-transfer.md)：ファイルのアップロードやダウンロードを設計するとき
- [Web API の非同期と API Gateway パターン](async-and-api-gateway.md)：複数のマイクロサービスを束ねる窓口を設計するとき
- [Web API の性能・レート制限・タイムアウト](performance-and-rate-limit.md)：ページングや負荷対策を設計するとき
- [Web API の認証と権限制御](authentication-and-authorization.md)：認証・認可やロール管理を設計するとき
- [Web API のセキュリティ](security.md)：セキュリティヘッダーや CORS、セッション Cookie を設計するとき
- [Web API の AWS 機能配置とリリース](aws-feature-placement-and-release.md)：機能をマネージドサービスに寄せるとき、リリース方式を決めるとき
- [Web API のオブザーバビリティ](observability.md)：監視・通知やヘルスチェックを設計するとき
