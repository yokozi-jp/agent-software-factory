-- Better Auth の表を置く auth スキーマ (docs/adr/0022)。
-- データベースの所有者 (migration 用のロール) が実行する。
--
-- auth_service と app_user のロールは、このファイルの前にインフラが作る。
-- - auth_service: Better Auth だけが使う。auth スキーマを所有し、search_path を auth にして接続する。
-- - app_user: 業務の処理が使う。auth スキーマの権限を持たない。RLS を迂回するロール (BYPASSRLS、所有者) にしない。
--
-- auth の表は RLS の対象にしない。隔離は、app_user に権限がないことと Better Auth のコードに依存する。

CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION auth_service;

REVOKE ALL ON SCHEMA auth FROM PUBLIC;
REVOKE ALL ON SCHEMA auth FROM app_user;
REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE auth_service IN SCHEMA auth REVOKE ALL ON TABLES FROM app_user;
