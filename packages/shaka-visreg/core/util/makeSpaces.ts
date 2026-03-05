export default function makeSpaces (length: number) {
  let i = 0;
  let result = '';
  while (i < length) {
    result += ' ';
    i++;
  }
  return result;
}
