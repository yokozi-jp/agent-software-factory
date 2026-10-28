// What a check prints, and the GitHub Actions workflow-command escaping that the warnings share.

export interface Output {
  readonly stdout: string;
  readonly stderr: string;
}

// The environment variables the messages read. GITHUB_ACTIONS is "true" in GitHub Actions.
export interface Env {
  readonly GITHUB_ACTIONS?: string | undefined;
  readonly GITHUB_SERVER_URL?: string | undefined;
  readonly GITHUB_REPOSITORY?: string | undefined;
}

// A workflow command ends at a newline, and % starts an escape (Workflow commands for GitHub Actions).
export const annotationText = (text: string): string =>
  text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
