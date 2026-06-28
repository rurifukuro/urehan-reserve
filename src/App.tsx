import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ReservePage } from './pages/ReservePage';
import { HomePage } from './pages/HomePage';

// 取り置きページは `/#/r/:slug`（HashRouter＝GitHub Pages のサブパス配信に強い）。
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/r/:slug" element={<ReservePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
