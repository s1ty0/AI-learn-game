export function mixLight(scores: number[]) {
  const maximum = Math.max(...scores);
  const exp = scores.map(score => Math.exp(score - maximum));
  const sum = exp.reduce((a, b) => a + b, 0);
  const weights = exp.map(value => value / sum);
  return { weights, output: weights.reduce((value, weight, index) => value + weight * [2, 6, 10][index], 0) };
}
