// Detection-power fixture (#43) for the React rules of apps/web/src (the react and react-effect rules in the
// root vite.config.ts, docs/web-frontend/static-analysis.md). Each component below is what a rule must report. If
// a rule is turned off, or its `files` stop reaching apps/web/src/, its disable comment is unused and `vp check`
// fails (reportUnusedDisableDirectives). Knip skips __fixtures__/, and nothing imports this file.
// The examples are those in the README of eslint-plugin-react-you-might-not-need-an-effect.
import { useEffect, useState } from "react";

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

export function DerivedState({ first, last }: { first: string; last: string }) {
  const [fullName, setFullName] = useState("");
  useEffect(() => {
    // oxlint-disable-next-line react-effect/no-derived-state -- fixture: a value that can be computed during render
    setFullName(`${first} ${last}`);
  }, [first, last]);
  return <p>{fullName}</p>;
}

export function ChainStateUpdates() {
  const [round, setRound] = useState(1);
  const [isGameOver, setIsGameOver] = useState(false);
  useEffect(() => {
    // oxlint-disable-next-line react-effect/no-chain-state-updates -- fixture: state set because other state changed
    setIsGameOver(true);
  }, [round]);
  return <button onClick={() => setRound(round + 1)}>{String(isGameOver)}</button>;
}

export function EventHandlerFromState() {
  const [dataToSubmit, setDataToSubmit] = useState("");
  useEffect(() => {
    // oxlint-disable-next-line react-effect/no-event-handler -- fixture: an event handled in an effect
    if (dataToSubmit) {
      window.alert(dataToSubmit);
    }
  }, [dataToSubmit]);
  return <input onChange={(event) => setDataToSubmit(event.target.value)} />;
}

export function AdjustStateOnPropChange({ items }: { items: string[] }) {
  const [isReverse, setIsReverse] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  useEffect(() => {
    // oxlint-disable-next-line react-effect/no-adjust-state-on-prop-change -- fixture: some state adjusted when a prop changes
    setSelection(null);
  }, [items]);
  return (
    <button onClick={() => setIsReverse(!isReverse)}>
      {selection}
      {items.length}
    </button>
  );
}

export function ResetAllStateOnPropChange({ items }: { items: string[] }) {
  const [_selection, setSelection] = useState(null);
  // oxlint-disable-next-line react-effect/no-reset-all-state-on-prop-change -- fixture: all state reset when a prop changes
  useEffect(() => {
    // oxlint-disable-next-line react-effect/no-adjust-state-on-prop-change -- fixture: this rule reports the same reset
    setSelection(null);
  }, [items]);
  return null;
}

export function PassLiveStateToParent({
  onTextChanged,
}: {
  onTextChanged: (text: string) => void;
}) {
  const [text, setText] = useState("");
  useEffect(() => {
    // oxlint-disable-next-line react-effect/no-pass-live-state-to-parent -- fixture: live state passed to the parent
    onTextChanged(text);
  }, [onTextChanged, text]);
  return <input onChange={(event) => setText(event.target.value)} />;
}

declare function useQuery(url: string): { data: string };

export function PassDataToParent({ onDataFetched }: { onDataFetched: (data: string) => void }) {
  const { data } = useQuery("/data");
  useEffect(() => {
    // oxlint-disable-next-line react-effect/no-pass-data-to-parent -- fixture: fetched data passed to the parent
    onDataFetched(data);
  }, [data, onDataFetched]);
  return null;
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => {
    // oxlint-disable-next-line react-effect/no-external-store-subscription, react-effect/no-initialize-state -- fixture: a subscription in an effect (the second rule reports this line too)
    setIsOnline(navigator.onLine);
    const update = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", update);
    return () => window.removeEventListener("online", update);
  }, []);
  return isOnline;
}

export function InitializeState() {
  const [state, setState] = useState("");
  useEffect(() => {
    // oxlint-disable-next-line react-effect/no-initialize-state -- fixture: state initialized in an effect
    setState("Hello World");
  }, []);
  return <p>{state}</p>;
}
