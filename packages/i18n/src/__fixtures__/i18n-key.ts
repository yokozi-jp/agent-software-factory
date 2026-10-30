// Detection-power fixture (#417) for i18n/literal-key in packages/i18n/src (the rule in the root vite.config.ts,
// tools/lint-plugins/src/i18n-plugin.ts, docs/adr/0044). Each call below is what the rule must report. If the rule is
// turned off, or its `files` stop reaching packages/i18n/src/, its disable comment is unused and `vp check` fails
// (reportUnusedDisableDirectives). i18next-cli ignores __fixtures__/, and Knip skips it; nothing imports this file.
declare function t(key: string): string;
declare const key: string;

// oxlint-disable-next-line i18n/literal-key -- fixture: a key that is a variable
export const fromVariable = t(key);

// oxlint-disable-next-line i18n/literal-key -- fixture: a key built from a template
export const fromTemplate = t(`home.${key}`);

declare const i18n: { t: (key: string) => string };
declare function useTranslation(): { t: (key: string) => string };

// oxlint-disable-next-line i18n/literal-key -- fixture: a key that is a variable, through i18n.t
export const fromI18n = i18n.t(key);

const { t: translate } = useTranslation();

// oxlint-disable-next-line i18n/literal-key -- fixture: a key that is a variable, through the t of useTranslation
export const fromHook = translate(key);
