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

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['migrator', 'app_user', 'auth_service'] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I LOGIN', role_name);
    END IF;
  END LOOP;

  EXECUTE format('GRANT CONNECT ON DATABASE %I TO migrator, app_user, auth_service', current_database());
  EXECUTE format('GRANT CREATE ON DATABASE %I TO migrator', current_database());

  -- RDS と Aurora の IAM DB authentication のロール。ローカルと CI にはないので、あるときだけ付ける。
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'rds_iam') THEN
    GRANT rds_iam TO migrator, app_user, auth_service;
  END IF;
END
$$;
