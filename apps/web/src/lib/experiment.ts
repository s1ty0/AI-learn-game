export function experiment(mask: boolean, future: number): number[][] {
  const full = (2 + 3 * 6 + 2 * future) / 6;
  return mask ? [[2], [5], [full]] : [[full], [full], [full]];
}

export function weights(mask: boolean): number[][] {
  return mask ? [[1, 0, 0], [.25, .75, 0], [1 / 6, 3 / 6, 2 / 6]] : Array.from({ length: 3 }, () => [1 / 6, 3 / 6, 2 / 6]);
}
