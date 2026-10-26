export const tryParseJson = <T>(content: string): T | undefined => {
  try {
    const parsed = JSON.parse(content);
    return parsed as T;
  } catch {
    return undefined;
  }
}
