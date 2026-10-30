-- ロールを作る。冪等で、何度流しても失敗しない (docs/adr/0025)。
-- master user (ローカルと CI では testcontainers の superuser) が、migration の前に 1 回流す。
--
-- ロールは DB 全体のもので、テンプレートの DB の複製と衝突するので、migration の履歴に乗せない。
-- 表、スキーマ、GRANT は migration に書く。パスワードはここに書かない (本番は IAM DB authentication、
-- ローカルは流した後に ALTER ROLE で設定する)。
--
-- - migrator: migration を流す。表とスキーマの所有者。
-- - app_user: 業務の処理が使う。
-- - auth_service: Better Auth だけが使う。
-- - outbox_relay: Outbox を読んで SQS へ送る処理だけが使う (Issue #269、docs/adr/0029)。messaging.outbox の
--   SELECT、UPDATE、DELETE だけを持ち、全テナントの行を読む。ほかのロールとちがい、Secrets Manager の別の秘密で
--   パスワード認証する。そのため rds_iam を付けない (rds_iam を持つロールは IAM 認証しか使えない)。
--   app_user はメンバーにならない。
-- - <モジュール>_module (claim_module、approval_module、closing_module): モジュールごとの NOLOGIN のロール。
--   app_user が SET LOCAL ROLE で切り替えて使い、モジュールの表の所有を DB の権限で止める (Issue #268、
--   docs/adr/0029)。権限は migration の GRANT で与える。

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['migrator', 'app_user', 'auth_service', 'outbox_relay'] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = role_name) THEN
      -- 権限の属性は明示する。RLS を迂回するロールは作らない (docs/adr/0011)。
      EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS', role_name);
    END IF;
  END LOOP;

  -- モジュールのロール。ログインできず、RLS も迂回しない。app_user には INHERIT FALSE で入れる: 権限を継承せず、
  -- SET ROLE で切り替えたトランザクションの中でだけ、そのロールの権限で動く。INHERIT の指定は PostgreSQL 16 以降。
  FOREACH role_name IN ARRAY ARRAY['claim_module', 'approval_module', 'closing_module'] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS', role_name);
    END IF;
    -- 何度流しても同じ状態にする。すでに入っていても、INHERIT と SET の指定を上書きする。
    EXECUTE format('GRANT %I TO app_user WITH INHERIT FALSE, SET TRUE', role_name);
  END LOOP;

  -- PostgreSQL は PUBLIC に CONNECT を既定で与えるので、この GRANT だけでは接続を絞らない。
  -- 明示して、PUBLIC の権限を外した環境でも同じ結果にする。
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO migrator, app_user, auth_service, outbox_relay', current_database());
  EXECUTE format('GRANT CREATE ON DATABASE %I TO migrator', current_database());

  -- RDS と Aurora の IAM DB authentication のロール。ローカルと CI にはないので、あるときだけ付ける。
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'rds_iam') THEN
    GRANT rds_iam TO migrator, app_user, auth_service;
  END IF;
END
$$;
