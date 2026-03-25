export type SearchResult = {
  match: boolean;
  ranges: [number, number][];
};

export const containsSearch = (
  subject: string,
  pattern: string
): SearchResult => {
  const result: SearchResult = {
    match: false,
    ranges: [],
  };
  const foundIndex = subject.toLowerCase().indexOf(pattern.toLowerCase());

  if (foundIndex !== -1) {
    result.match = true;
    result.ranges = [[foundIndex, foundIndex + pattern.length]];
  }

  return result;
};
