// ルート（slug 無し）に来たときの案内。取り置きは個別URL（/#/r/<slug>）が必要。
export function HomePage() {
  return (
    <div className="page center">
      <div className="card narrow">
        <div className="brand">🎫 取り置き予約</div>
        <p className="muted">
          サークルから配布された<strong>取り置きページのURL</strong>から開いてください。
        </p>
        <p className="muted small">
          このページ単体では予約できません。各サークルの取り置きURL（QRコードやSNSのリンク）からアクセスしてください。
        </p>
      </div>
    </div>
  );
}
