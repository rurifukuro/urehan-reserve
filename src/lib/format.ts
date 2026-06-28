// 金額表示（¥1,200 形式）。
export function yen(n: number): string {
  return '¥' + Math.round(n).toLocaleString('ja-JP');
}
