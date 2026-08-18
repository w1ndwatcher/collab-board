import { Routes, Route } from "react-router-dom";
import HomePage from "./HomePage.jsx";
import BoardPage from "./BoardPage.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/board/:boardId" element={<BoardPage />} />
    </Routes>
  );
}
