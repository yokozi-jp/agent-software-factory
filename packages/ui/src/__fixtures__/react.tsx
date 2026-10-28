// Detection-power fixture (#43, #230) that the React, console and XSS rules of the root vite.config.ts reach
// packages/ui/src/ too (docs/adr/0034), where the parts of apps/web live. The rules themselves have their fixtures
// in apps/web/src/__fixtures__/. If a rule is turned off, or its `files` stop reaching packages/ui/src/, its
// disable comment is unused and `vp check` fails (reportUnusedDisableDirectives). Knip skips __fixtures__/, and
// nothing imports this file.

export function IndexKey({ items }: { items: string[] }) {
  return (
    <ul>
      {items.map((item, index) => (
        // oxlint-disable-next-line react/no-array-index-key -- fixture: the index of an array as a key
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

// oxlint-disable-next-line web-xss/no-html-injection -- fixture: a string inserted as HTML
export const html = <div dangerouslySetInnerHTML={{ __html: "<b>fixture</b>" }} />;

// oxlint-disable-next-line no-console -- fixture: the frontend logs nothing to the browser console
console.log("fixture");
