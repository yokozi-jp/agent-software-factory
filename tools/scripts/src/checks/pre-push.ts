// What git writes to the standard input of a pre-push hook, read once for every check that runs there.
// Git writes "<local ref> <local object name> <remote ref> <remote object name>" per ref (githooks(5)). The
// object name is all zeros for a ref that is deleted (local) or new (remote).

export interface PushedRef {
  readonly localRef: string;
  readonly localSha: string;
  readonly remoteRef: string;
  readonly remoteSha: string;
  // The ref is deleted: its local object name is all zeros, so there is no commit to look at.
  readonly deleted: boolean;
  // The remote has no such ref yet: its remote object name is all zeros.
  readonly created: boolean;
}

const allZeros = /^0+$/;

// Git writes four fields on every line; any other line is not a ref and is skipped.
const isRefLine = (fields: string[]): fields is [string, string, string, string] =>
  fields.length === 4;

export function parsePrePush(stdin: string): PushedRef[] {
  return stdin
    .split("\n")
    .map((line) => line.split(" "))
    .filter(isRefLine)
    .map(([localRef, localSha, remoteRef, remoteSha]) => ({
      localRef,
      localSha,
      remoteRef,
      remoteSha,
      deleted: allZeros.test(localSha),
      created: allZeros.test(remoteSha),
    }));
}

// The commits being pushed: the local object name of each ref that is not deleted.
export const pushedTips = (stdin: string): string[] =>
  parsePrePush(stdin)
    .filter((ref) => !ref.deleted)
    .map((ref) => ref.localSha);
